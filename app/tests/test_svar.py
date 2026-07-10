"""Tests for the /svar staff share-link surface (issue #13).

Self-contained: creates its own org + staff + token via direct SQL and drives
the endpoints through the test client. The /svar surface itself is
unauthenticated, so most tests need no auth fixtures; the issue #7 acceptance
test additionally authenticates (an ``org_user`` row + ``X-Test-User``, the
same pattern as ``conftest.py``) because it crosses over into the manager-only
``/compute/conflicts`` and ``/data/shifts`` endpoints. Skips when no DB is
reachable.
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import psycopg
import pytest

from app import app
from config import DATABASE_URL
from dbfixtures import db_available
from weeks import iso_week_of, local_instant, week_monday

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


def _add_recurring(cur, org_id, staff_id, kind, weekday, start=0, end=1440, source=None):
    cur.execute(
        """INSERT INTO availability_interval (org_id, staff_id, kind, weekday, start_minute, end_minute, source)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (org_id, staff_id, kind, weekday, start, end, source),
    )
    return str(cur.fetchone()['id'])


def _publish_shift(cur, org_id, staff_id, tz, hours_from_now=26, length=6):
    starts = datetime.now(timezone.utc) + timedelta(hours=hours_from_now)
    ends = starts + timedelta(hours=length)
    monday = week_monday(iso_week_of(starts, tz))
    snapshot = [{'id': str(uuid.uuid4()), 'staff_id': str(staff_id),
                 'starts_at': starts.isoformat(), 'ends_at': ends.isoformat(),
                 'note': None}]
    cur.execute(
        'DELETE FROM publication WHERE org_id = %s AND period_start < %s AND period_end > %s',
        (org_id, monday + timedelta(days=7), monday),
    )
    cur.execute(
        """INSERT INTO publication (org_id, period_start, period_end, shifts)
           VALUES (%s, %s, %s, %s)""",
        (org_id, monday, monday + timedelta(days=7), json.dumps(snapshot)),
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


def test_hourly_wage_never_leaks_to_svar(client, org):
    # The wage is manager-only data (issue #17); /svar is unauthenticated.
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            cur.execute('UPDATE staff SET hourly_wage = 173.50 WHERE id = %s', (staff_id,))
        conn.commit()
    resp = client.get(f'/svar/{token}/data')
    assert resp.status_code == 200
    assert 'hourly_wage' not in resp.get_data(as_text=True)

    resp = client.put(f'/svar/{token}/availability', json={'hourly_wage': 200})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_field'


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

def test_bare_page_falls_through_to_spa_and_data_is_json(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    # Bare page routes to the SPA, not the JSON API 'not_found' branch. Backend
    # CI has no built frontend/dist, so the SPA fallback may return its own
    # 'frontend not built' 404 — assert routing + the surface headers rather
    # than requiring built HTML.
    page = client.get(f'/svar/{token}')
    page_body = page.get_json(silent=True)
    assert page_body is None or page_body.get('error') != 'not_found'
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


# --- end-to-end: svar-registered availability is respected by conflicts (#7) ---

def _next_weekday(iso_weekday):
    """The next date strictly after today whose ISO weekday is `iso_weekday`
    (1=Mon .. 7=Sun). Derived from today so the test never pins a calendar
    date and stays inside the add_exceptions ± window."""
    today = date.today()
    ahead = (iso_weekday - today.isoweekday()) % 7 or 7
    return today + timedelta(days=ahead)


def _conflicts(client, staff_id, start_dt, end_dt):
    resp = client.post('/compute/conflicts', json={'shifts': [{
        'staff_id': str(staff_id),
        'starts_at': start_dt.isoformat(),
        'ends_at': end_dt.isoformat(),
    }]})
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def test_svar_availability_respected_by_conflicts(client, org):
    """The issue #7 "Done when": availability a worker registers through the
    share link is what the conflict engine sees. Writes go in via
    PUT /svar/:token/availability (the public surface) and the assertions read
    back through /compute/conflicts and the /data/shifts write path — the same
    engine a manager's shift editor uses."""
    tz = 'Europe/Stockholm'
    user_id = f'user_svar_{uuid.uuid4().hex}'
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org, name='Ada Ohlsson')
            # Authenticate the same client for the manager-only endpoints.
            cur.execute('INSERT INTO org_user (user_id, org_id) VALUES (%s, %s)', (user_id, org))
        conn.commit()
    client.environ_base['HTTP_X_TEST_USER'] = user_id

    mon, sun, tue, wed = (_next_weekday(d) for d in (1, 7, 2, 3))
    # Worker registers: wish Mon 09:00–17:00, hard block all day Sunday, and a
    # single vacation day (an upcoming Wednesday) — all as local wall-clock.
    put = client.put(f'/svar/{token}/availability', json={
        'wishes': [{'weekday': 1, 'start_minute': 540, 'end_minute': 1020}],
        'blocks': [{'weekday': 7, 'start_minute': 0, 'end_minute': 1440}],
        'add_exceptions': [{'on_date': wed.isoformat()}],
    })
    assert put.status_code == 200, put.get_json()

    def span(day):  # a 10:00–15:00 local shift on `day`
        return local_instant(day, 600, tz), local_instant(day, 900, tz)

    # Recurring Sunday block → hard `blocked` conflict. A blocked shift is also
    # outside the (Mon-only) wishes, so don't assert warnings is empty here.
    sun_start, sun_end = span(sun)
    blocked = _conflicts(client, staff_id, sun_start, sun_end)
    assert 'blocked' in {c['type'] for c in blocked['conflicts']}

    # Dated vacation exception → hard `blocked` on that specific date.
    wed_start, wed_end = span(wed)
    vacation = _conflicts(client, staff_id, wed_start, wed_end)
    assert 'blocked' in {c['type'] for c in vacation['conflicts']}

    # Inside the Monday wish → fully clean: no conflicts and no warnings.
    clean = _conflicts(client, staff_id, *span(mon))
    assert clean['conflicts'] == [] and clean['warnings'] == []

    # Tuesday: wishes exist but don't cover it → soft `outside_wishes` warning,
    # no hard conflict.
    tuesday = _conflicts(client, staff_id, *span(tue))
    assert tuesday['conflicts'] == []
    assert 'outside_wishes' in {w['type'] for w in tuesday['warnings']}

    # Enforcement: the write path rejects a shift over the block without force.
    rejected = client.post('/data/shifts', json={
        'staff_id': str(staff_id),
        'starts_at': sun_start.isoformat(),
        'ends_at': sun_end.isoformat(),
    })
    assert rejected.status_code == 409
    assert rejected.get_json()['error'] == 'conflict'
    # ...and accepts it with ?force=true.
    forced = client.post('/data/shifts?force=true', json={
        'staff_id': str(staff_id),
        'starts_at': sun_start.isoformat(),
        'ends_at': sun_end.isoformat(),
    })
    assert forced.status_code == 201, forced.get_json()


# --- per-kind non-destructive PUT + dated wish + staff params (#40) ---

def test_put_omitting_blocks_preserves_recurring_blocks(client, org):
    """The wipe #40 fixes: a v2 phone save sends only `wishes`; a manager-set
    recurring block must survive it."""
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            _add_recurring(cur, org, staff_id, 'block', 7)  # manager's Sunday block
            _add_recurring(cur, org, staff_id, 'wish', 3)   # a pre-existing wish
        conn.commit()
    body = client.put(f'/svar/{token}/availability', json={
        'wishes': [{'weekday': 1, 'start_minute': 540, 'end_minute': 1020}]}).get_json()
    assert {b['weekday'] for b in body['availability']['blocks']} == {7}   # untouched
    assert {w['weekday'] for w in body['availability']['wishes']} == {1}   # replaced


def test_put_empty_list_clears_only_that_kind(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            _add_recurring(cur, org, staff_id, 'block', 7)
            _add_recurring(cur, org, staff_id, 'wish', 3)
        conn.commit()
    body = client.put(f'/svar/{token}/availability', json={'blocks': []}).get_json()
    assert body['availability']['blocks'] == []                            # cleared
    assert {w['weekday'] for w in body['availability']['wishes']} == {3}   # untouched


def test_put_empty_body_is_noop(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            _add_recurring(cur, org, staff_id, 'wish', 3)
            _add_recurring(cur, org, staff_id, 'block', 7)
        conn.commit()
    resp = client.put(f'/svar/{token}/availability', json={})
    assert resp.status_code == 200
    body = resp.get_json()
    assert {w['weekday'] for w in body['availability']['wishes']} == {3}
    assert {b['weekday'] for b in body['availability']['blocks']} == {7}


def test_put_preserves_provenance_on_verbatim_rows(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            _add_recurring(cur, org, staff_id, 'wish', 2, 540, 1020, source='manager')
            _add_recurring(cur, org, staff_id, 'wish', 4, 540, 1020)  # pre-#40 row, provenance unknown
        conn.commit()
    body = client.put(f'/svar/{token}/availability', json={'wishes': [
        {'weekday': 2, 'start_minute': 540, 'end_minute': 1020},   # verbatim round-trip
        {'weekday': 4, 'start_minute': 540, 'end_minute': 1020},   # verbatim, unknown source
        {'weekday': 5, 'start_minute': 600, 'end_minute': 960},    # actually new
    ]}).get_json()
    by_day = {w['weekday']: w['source'] for w in body['availability']['wishes']}
    assert by_day == {2: 'manager', 4: None, 5: 'staff'}


@pytest.mark.parametrize('payload', [{'wishes': None}, {'blocks': None}])
def test_put_explicit_null_list_is_400(client, org, payload):
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    assert client.put(f'/svar/{token}/availability', json=payload).status_code == 400


def test_add_dated_wish_exception_roundtrips_and_not_in_wishes(client, org):
    today = datetime.now(timezone.utc).date()
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    body = client.put(f'/svar/{token}/availability', json={
        'add_exceptions': [{'on_date': (today + timedelta(days=5)).isoformat(),
                            'kind': 'wish', 'note': 'Kan extra'}]}).get_json()
    exc = body['availability']['exceptions']
    assert len(exc) == 1
    assert exc[0]['kind'] == 'wish' and exc[0]['note'] == 'Kan extra'
    assert exc[0]['source'] == 'staff'                     # provenance stamped
    assert body['availability']['wishes'] == []            # not double-listed


@pytest.mark.parametrize('bad', [{'kind': 'maybe'}, {'note': 'x' * 501}])
def test_add_exception_validation_400(client, org, bad):
    today = datetime.now(timezone.utc).date()
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    ex = {'on_date': (today + timedelta(days=5)).isoformat(), **bad}
    assert client.put(f'/svar/{token}/availability', json={'add_exceptions': [ex]}).status_code == 400


def test_staff_params_roundtrip_presence_and_clear(client, org):
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    # set both (note is trimmed, empty→null)
    body = client.put(f'/svar/{token}/availability', json={
        'desired_shifts_per_week': 4, 'availability_note': '  pluggar tisdagar  '}).get_json()
    assert body['staff']['desired_shifts_per_week'] == 4
    assert body['staff']['availability_note'] == 'pluggar tisdagar'
    # a save that omits them preserves
    body = client.put(f'/svar/{token}/availability', json={'wishes': []}).get_json()
    assert body['staff']['desired_shifts_per_week'] == 4
    # readback via GET matches
    got = client.get(f'/svar/{token}/data').get_json()['staff']
    assert got['desired_shifts_per_week'] == 4 and got['availability_note'] == 'pluggar tisdagar'
    # explicit null clears
    body = client.put(f'/svar/{token}/availability', json={
        'desired_shifts_per_week': None, 'availability_note': None}).get_json()
    assert body['staff']['desired_shifts_per_week'] is None
    assert body['staff']['availability_note'] is None


@pytest.mark.parametrize('payload', [
    {'desired_shifts_per_week': 3.5},
    {'desired_shifts_per_week': True},
    {'desired_shifts_per_week': 51},
    {'availability_note': 'x' * 1001},
])
def test_staff_params_validation_400(client, org, payload):
    with _conn() as conn:
        with conn.cursor() as cur:
            _, token = _mk_staff(cur, org)
        conn.commit()
    assert client.put(f'/svar/{token}/availability', json=payload).status_code == 400


# --- publications as date ranges (#10) ---

def test_multiweek_publication_spans_weeks(client, org):
    """One publication spanning several ISO weeks: the link view shows shifts
    from across the whole span (the read is a plain overlap query)."""
    now = datetime.now(timezone.utc)
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            snapshot = []
            for days_ahead in (2, 9):  # two shifts in different ISO weeks
                starts = now + timedelta(days=days_ahead)
                snapshot.append({'id': str(uuid.uuid4()), 'staff_id': str(staff_id),
                                 'starts_at': starts.isoformat(),
                                 'ends_at': (starts + timedelta(hours=4)).isoformat(),
                                 'note': None})
            cur.execute(
                """INSERT INTO publication (org_id, period_start, period_end, shifts)
                   VALUES (%s, %s, %s, %s)""",
                (org, now.date() - timedelta(days=1), now.date() + timedelta(days=14),
                 json.dumps(snapshot)),
            )
        conn.commit()
    sched = client.get(f'/svar/{token}/data').get_json()['schedule']
    assert sched['shift_count'] == 2
    assert sched['hours'] == 8.0


def test_staff_read_snapshot_not_live_edits(client, org):
    """The issue #10 "Done when": with the manager mid-edit on a published
    period, the staff link shows exactly the last published snapshot."""
    user_id = f'user_pub_{uuid.uuid4().hex}'
    with _conn() as conn:
        with conn.cursor() as cur:
            staff_id, token = _mk_staff(cur, org)
            cur.execute('INSERT INTO org_user (user_id, org_id) VALUES (%s, %s)', (user_id, org))
        conn.commit()
    client.environ_base['HTTP_X_TEST_USER'] = user_id

    starts = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
    ends = starts + timedelta(hours=6)
    created = client.post('/data/shifts', json={
        'staff_id': str(staff_id),
        'starts_at': starts.isoformat(), 'ends_at': ends.isoformat()})
    assert created.status_code == 201, created.get_json()
    shift = created.get_json()['shift']

    frm = (starts.date() - timedelta(days=1)).isoformat()
    to = (starts.date() + timedelta(days=1)).isoformat()
    pub = client.post('/action/publish', json={'from': frm, 'to': to})
    assert pub.status_code == 200, pub.get_json()
    assert pub.get_json()['shift_count'] == 1

    sched = client.get(f'/svar/{token}/data').get_json()['schedule']
    assert sched['shift_count'] == 1
    published_start = sched['shifts'][0]['starts_at']

    # Manager moves the live shift — the link still shows the snapshot.
    moved = starts + timedelta(hours=2)
    patched = client.patch(f"/data/shifts/{shift['id']}", json={
        'starts_at': moved.isoformat(), 'ends_at': (ends + timedelta(hours=2)).isoformat()})
    assert patched.status_code == 200, patched.get_json()
    sched = client.get(f'/svar/{token}/data').get_json()['schedule']
    assert sched['shifts'][0]['starts_at'] == published_start

    # Re-publish → the link converges on the edit.
    assert client.post('/action/publish', json={'from': frm, 'to': to}).status_code == 200
    sched = client.get(f'/svar/{token}/data').get_json()['schedule']
    assert sched['shift_count'] == 1
    assert sched['shifts'][0]['starts_at'] != published_start


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
