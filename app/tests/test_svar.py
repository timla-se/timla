"""Tests for the /svar staff share-link surface (issue #13).

Self-contained: creates its own org + staff + token via direct SQL (the
surface is unauthenticated, so no client auth fixtures are needed) and drives
the endpoints through the test client. Skips when no DB is reachable.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from app import app
from config import DATABASE_URL
from dbfixtures import db_available
from weeks import iso_week_of

pytestmark = pytest.mark.skipif(not db_available(), reason='no database reachable at DATABASE_URL')


def _conn():
    return psycopg.connect(DATABASE_URL, row_factory=psycopg.rows.dict_row)


def _mk_org(cur, name='Svar Test', tz='Europe/Stockholm'):
    cur.execute('INSERT INTO organization (name, timezone) VALUES (%s, %s) RETURNING id', (name, tz))
    return cur.fetchone()['id']


def _mk_staff(cur, org_id, name='Ada Ohlsson', token=None, archived=False):
    token = token or f'tok_{uuid.uuid4().hex}'
    cur.execute(
        """INSERT INTO staff (org_id, name, share_token, archived_at)
           VALUES (%s, %s, %s, %s) RETURNING id""",
        (org_id, name, token, datetime.now(timezone.utc) if archived else None),
    )
    return cur.fetchone()['id'], token


def _add_exception(cur, org_id, staff_id, on_date, start=0, end=1440):
    cur.execute(
        """INSERT INTO availability_interval (org_id, staff_id, kind, on_date, start_minute, end_minute)
           VALUES (%s, %s, 'block', %s, %s, %s) RETURNING id""",
        (org_id, staff_id, on_date, start, end),
    )
    return str(cur.fetchone()['id'])


def _publish_shift(cur, org_id, staff_id, tz, hours_from_now=26, length=6):
    starts = datetime.now(timezone.utc) + timedelta(hours=hours_from_now)
    ends = starts + timedelta(hours=length)
    week = iso_week_of(starts, tz)
    snapshot = [{'id': str(uuid.uuid4()), 'staff_id': str(staff_id),
                 'starts_at': starts.isoformat(), 'ends_at': ends.isoformat()}]
    cur.execute(
        """INSERT INTO publication (org_id, week, shifts) VALUES (%s, %s, %s)
           ON CONFLICT (org_id, week) DO UPDATE SET shifts = EXCLUDED.shifts""",
        (org_id, week, json.dumps(snapshot)),
    )
    return starts


@pytest.fixture
def org():
    with _conn() as conn:
        with conn.cursor() as cur:
            org_id = _mk_org(cur)
        conn.commit()
    yield org_id
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM organization WHERE id = %s', (org_id,))
        conn.commit()


@pytest.fixture
def client():
    app.config['TESTING'] = True
    import ratelimit
    ratelimit.reset()  # keep the shared limiter from bleeding across tests
    return app.test_client()


# --- resolver ---

def test_unknown_token_is_generic_404(client):
    resp = client.get('/svar/nope/data')
    assert resp.status_code == 404
    assert resp.get_json()['error'] == 'not_found'


def test_archived_staff_token_is_404(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org, archived=True)
        conn.commit()
    assert client.get(f'/svar/{token}/data').status_code == 404


def test_context_shape(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org, name='Ada Ohlsson')
            _publish_shift(cur, org, staff_id, 'Europe/Stockholm')
        conn.commit()
    body = client.get(f'/svar/{token}/data').get_json()
    assert body['staff']['first_name'] == 'Ada'
    assert body['org']['timezone'] == 'Europe/Stockholm'
    assert body['org']['initials'] == 'ST'  # "Svar-testorg"
    assert set(body['availability']) == {'wishes', 'blocks', 'exceptions'}
    sched = body['schedule']
    assert 'from' in sched and 'to' in sched and 'week' not in json.dumps(sched)
    assert sched['shift_count'] == 1 and sched['hours'] == 6.0
    assert sched['shifts'][0]['date']  # date-grouped


# --- PUT: recurring ---

def test_put_recurring_last_write_wins(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    client.put(f'/svar/{token}/availability', json={'wishes': [{'weekday': 1, 'start_minute': 0, 'end_minute': 1440}]})
    body = client.put(f'/svar/{token}/availability', json={'wishes': [{'weekday': 2, 'start_minute': 480, 'end_minute': 960}]}).get_json()
    wishes = body['availability']['wishes']
    assert len(wishes) == 1
    assert (wishes[0]['weekday'], wishes[0]['start_minute'], wishes[0]['end_minute']) == (2, 480, 960)


def test_put_recurring_full_replace(client, org):
    # No more bucket/non-bucket split: a worker save replaces the whole
    # recurring layer, so a pre-existing manager row is gone unless re-submitted.
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            cur.execute(
                """INSERT INTO availability_interval (org_id, staff_id, kind, weekday, start_minute, end_minute)
                   VALUES (%s, %s, 'wish', 3, 540, 1020)""",
                (org, staff_id),
            )
        conn.commit()
    body = client.put(f'/svar/{token}/availability', json={'wishes': [{'weekday': 1, 'start_minute': 360, 'end_minute': 720}]}).get_json()
    spans = {(w['weekday'], w['start_minute'], w['end_minute']) for w in body['availability']['wishes']}
    assert spans == {(1, 360, 720)}  # old (3,540,1020) replaced, only the submitted row remains


def test_put_accepts_arbitrary_range_and_rejects_invalid(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    # Arbitrary minute range now accepted (was bucket-only before).
    ok = client.put(f'/svar/{token}/availability', json={'wishes': [{'weekday': 1, 'start_minute': 500, 'end_minute': 815}]})
    assert ok.status_code == 200
    assert (ok.get_json()['availability']['wishes'][0]['start_minute']) == 500
    # start >= end is rejected.
    bad = client.put(f'/svar/{token}/availability', json={'wishes': [{'weekday': 1, 'start_minute': 800, 'end_minute': 800}]})
    assert bad.status_code == 400 and bad.get_json()['error'] == 'invalid'
    # out of the 0..1440 window is rejected.
    oob = client.put(f'/svar/{token}/availability', json={'wishes': [{'weekday': 1, 'start_minute': 0, 'end_minute': 1500}]})
    assert oob.status_code == 400


# --- PUT: exception delta (review H1) ---

def test_exception_delta_preserves_untouched_and_concurrent(client, org):
    today = datetime.now(timezone.utc).date()
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            keep_id = _add_exception(cur, org, staff_id, today + timedelta(days=3))
            remove_id = _add_exception(cur, org, staff_id, today + timedelta(days=4))
        conn.commit()
    # Worker removes one, adds one, keeps 'keep_id' by not mentioning it.
    body = client.put(f'/svar/{token}/availability', json={
        'remove_exception_ids': [remove_id],
        'add_exceptions': [{'on_date': (today + timedelta(days=5)).isoformat()}],
    }).get_json()
    dates = {e['on_date'] for e in body['availability']['exceptions']}
    assert (today + timedelta(days=3)).isoformat() in dates   # kept survives
    assert (today + timedelta(days=4)).isoformat() not in dates  # removed gone
    assert (today + timedelta(days=5)).isoformat() in dates   # added present

    # Simulate a concurrent manager add the worker never saw, then another
    # worker save that doesn't mention it — it must survive.
    with _conn() as conn:
        with conn.cursor() as cur:
            _add_exception(cur, org, staff_id, today + timedelta(days=9))
        conn.commit()
    body = client.put(f'/svar/{token}/availability', json={'wishes': []}).get_json()
    dates = {e['on_date'] for e in body['availability']['exceptions']}
    assert (today + timedelta(days=9)).isoformat() in dates


def test_partial_day_exception_retains_minutes(client, org):
    today = datetime.now(timezone.utc).date()
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            _add_exception(cur, org, staff_id, today + timedelta(days=2), start=480, end=720)
        conn.commit()
    body = client.put(f'/svar/{token}/availability', json={'wishes': []}).get_json()
    ex = body['availability']['exceptions'][0]
    assert ex['start_minute'] == 480 and ex['end_minute'] == 720


def test_remove_exception_id_from_other_staff_400(client, org):
    today = datetime.now(timezone.utc).date()
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org, name='Ada')
            other_id, _ = _mk_staff(cur, org, name='Bo')
            other_ex = _add_exception(cur, org, other_id, today + timedelta(days=1))
        conn.commit()
    resp = client.put(f'/svar/{token}/availability', json={'remove_exception_ids': [other_ex]})
    assert resp.status_code == 400


# --- validation ---

@pytest.mark.parametrize('payload', [
    {'bogus': 1},
    {'wishes': [{'weekday': 1, 'start_minute': 0, 'end_minute': 1440}] * 22},  # oversize
    {'add_exceptions': [{'on_date': '2000-01-01'}]},  # out of window
])
def test_put_validation_400(client, org, payload):
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    assert client.put(f'/svar/{token}/availability', json=payload).status_code == 400


# --- routing / headers / redirect ---

def test_bare_page_is_html_and_data_is_json(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    page = client.get(f'/svar/{token}')
    assert page.status_code == 200 and 'application/json' not in page.content_type
    assert page.headers['X-Frame-Options'] == 'DENY'
    assert page.headers['Referrer-Policy'] == 'no-referrer'
    data = client.get(f'/svar/{token}/data')
    assert data.status_code == 200 and data.is_json


def test_svar_404_carries_security_headers(client):
    resp = client.get('/svar/bad/data')
    assert resp.status_code == 404
    assert resp.headers['Cache-Control'] == 'no-store'
    assert resp.headers['X-Robots-Tag'] == 'noindex'


def test_link_redirects_to_svar(client):
    resp = client.get('/link/abc123')
    assert resp.status_code == 301
    assert resp.headers['Location'].endswith('/svar/abc123')
    assert resp.headers['Cache-Control'] == 'no-store'


# --- token lifecycle ---

def test_regenerated_token_kills_old(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, old = _mk_staff(cur, org)
        conn.commit()
    assert client.get(f'/svar/{old}/data').status_code == 200
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute('UPDATE staff SET share_token = %s WHERE id = %s', ('tok_new', staff_id))
        conn.commit()
    assert client.get(f'/svar/{old}/data').status_code == 404
    assert client.get('/svar/tok_new/data').status_code == 200


# --- rate limit ---

def test_rate_limit_is_ip_wide_across_tokens(client):
    codes = [client.get(f'/svar/guess{i}/data').status_code for i in range(40)]
    assert 429 in codes  # distinct tokens still share one IP bucket


# --- cross-org isolation ---

def test_cross_org_isolation(client):
    with _conn() as conn:
        with conn.cursor() as cur:
            org_a = _mk_org(cur, 'Alpha AB')
            org_b = _mk_org(cur, 'Beta AB')
            staff_a, token_a = _mk_staff(cur, org_a, name='Ada')
            _publish_shift(cur, org_b, _mk_staff(cur, org_b, name='Bo')[0], 'Europe/Stockholm')
        conn.commit()
    try:
        body = client.get(f'/svar/{token_a}/data').get_json()
        assert body['org']['name'] == 'Alpha AB'
        assert body['schedule']['shift_count'] == 0  # sees none of Beta's shifts
    finally:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM organization WHERE id = ANY(%s)', ([org_a, org_b],))
            conn.commit()
