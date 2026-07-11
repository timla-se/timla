"""/data/staffing-needs tests (issue #11): the demand document, atomic PUT
replace, overlap rejection, the day-level override rule, the headcount-0
"closed day" sentinel, DST-safe expansion, and the `configured` flag."""

import psycopg
import pytest

from app import app
from config import DATABASE_URL
from dbfixtures import db_available

pytestmark = pytest.mark.skipif(not db_available(), reason='no database reachable at DATABASE_URL')

WEEK_PATTERN = [
    {'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1},
    {'weekday': 1, 'start_minute': 720, 'end_minute': 960, 'headcount': 2},
    {'weekday': 6, 'start_minute': 600, 'end_minute': 960, 'headcount': 2},
]


def put_needs(client, recurring, expect=200):
    resp = client.put('/data/staffing-needs', json={'recurring': recurring})
    assert resp.status_code == expect, resp.get_json()
    return resp.get_json()


def expansion(client, period):
    resp = client.get(f'/data/staffing-needs?period={period}')
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


# --- document + PUT replace ---

def test_empty_document_shape(client):
    assert client.get('/data/staffing-needs').get_json() == {'recurring': [], 'exceptions': []}


def test_put_replaces_pattern_atomically(client):
    doc = put_needs(client, WEEK_PATTERN)
    assert [r['headcount'] for r in doc['recurring']] == [1, 2, 2]
    assert all('weekday' in r and 'id' in r for r in doc['recurring'])
    # A second PUT replaces, never stacks.
    doc = put_needs(client, [{'weekday': 2, 'start_minute': 0, 'end_minute': 60, 'headcount': 3}])
    assert len(doc['recurring']) == 1
    assert doc['recurring'][0]['weekday'] == 2
    # [] clears the whole pattern.
    assert put_needs(client, []) == {'recurring': [], 'exceptions': []}


def test_put_invalid_row_leaves_pattern_untouched(client):
    put_needs(client, WEEK_PATTERN)
    put_needs(client, [{'weekday': 1, 'start_minute': 0, 'end_minute': 60, 'headcount': 1},
                       {'weekday': 8, 'start_minute': 0, 'end_minute': 60, 'headcount': 1}],
              expect=400)
    assert len(client.get('/data/staffing-needs').get_json()['recurring']) == 3


def test_put_does_not_touch_exceptions(client):
    client.post('/data/staffing-needs/exceptions', json={'on_date': '2026-12-24', 'headcount': 0})
    doc = put_needs(client, [])
    assert len(doc['exceptions']) == 1


def test_put_rejects_overlap_within_weekday(client):
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 780, 'headcount': 1},
                       {'weekday': 1, 'start_minute': 720, 'end_minute': 960, 'headcount': 2}],
              expect=400)
    # The same intervals on different weekdays are fine.
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 780, 'headcount': 1},
                       {'weekday': 2, 'start_minute': 720, 'end_minute': 960, 'headcount': 2}])


def test_put_rejects_zero_headcount_recurring(client):
    put_needs(client, [{'weekday': 1, 'start_minute': 0, 'end_minute': 1440, 'headcount': 0}],
              expect=400)


def test_put_headcount_bounds_and_types(client):
    put_needs(client, [{'weekday': 1, 'start_minute': 0, 'end_minute': 60, 'headcount': 201}], expect=400)
    put_needs(client, [{'weekday': 1, 'start_minute': 0, 'end_minute': 60, 'headcount': 1.5}], expect=400)
    put_needs(client, [{'weekday': 1, 'start_minute': 0, 'end_minute': 60, 'headcount': True}], expect=400)


def test_put_unknown_fields_rejected(client):
    resp = client.put('/data/staffing-needs', json={'recurring': [], 'exceptions': []})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_field'
    resp = client.put('/data/staffing-needs', json={
        'recurring': [{'weekday': 1, 'start_minute': 0, 'end_minute': 60, 'headcount': 1, 'x': 1}]})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_field'


def test_put_requires_recurring_key(client):
    resp = client.put('/data/staffing-needs', json={})
    assert resp.status_code == 400


# --- exceptions ---

def test_exception_create_and_delete(client):
    resp = client.post('/data/staffing-needs/exceptions',
                       json={'on_date': '2026-07-15', 'start_minute': 600,
                             'end_minute': 900, 'headcount': 3})
    assert resp.status_code == 201
    row = resp.get_json()
    assert row['on_date'] == '2026-07-15' and row['headcount'] == 3

    assert client.delete(f"/data/staffing-needs/exceptions/{row['id']}").status_code == 204
    assert client.delete(f"/data/staffing-needs/exceptions/{row['id']}").status_code == 404
    assert client.get('/data/staffing-needs').get_json()['exceptions'] == []


def test_exception_minutes_default_to_full_day(client):
    resp = client.post('/data/staffing-needs/exceptions', json={'on_date': '2026-07-15', 'headcount': 2})
    assert resp.status_code == 201
    row = resp.get_json()
    assert (row['start_minute'], row['end_minute']) == (0, 1440)


def test_exception_zero_headcount_must_be_full_day(client):
    resp = client.post('/data/staffing-needs/exceptions',
                       json={'on_date': '2026-07-15', 'start_minute': 600,
                             'end_minute': 900, 'headcount': 0})
    assert resp.status_code == 400
    resp = client.post('/data/staffing-needs/exceptions', json={'on_date': '2026-07-15', 'headcount': 0})
    assert resp.status_code == 201


def test_exception_rejects_overlap_with_existing_dated_row(client):
    client.post('/data/staffing-needs/exceptions',
                json={'on_date': '2026-07-15', 'start_minute': 600, 'end_minute': 900, 'headcount': 1})
    resp = client.post('/data/staffing-needs/exceptions',
                       json={'on_date': '2026-07-15', 'start_minute': 840,
                             'end_minute': 1020, 'headcount': 2})
    assert resp.status_code == 400
    # Adjacent is not overlap; another date is unaffected.
    assert client.post('/data/staffing-needs/exceptions',
                       json={'on_date': '2026-07-15', 'start_minute': 900,
                             'end_minute': 1020, 'headcount': 2}).status_code == 201
    assert client.post('/data/staffing-needs/exceptions',
                       json={'on_date': '2026-07-16', 'start_minute': 600,
                             'end_minute': 900, 'headcount': 1}).status_code == 201


def test_exception_requires_headcount_and_valid_date(client):
    assert client.post('/data/staffing-needs/exceptions',
                       json={'on_date': '2026-07-15'}).status_code == 400
    assert client.post('/data/staffing-needs/exceptions',
                       json={'on_date': 'nyår', 'headcount': 1}).status_code == 400
    resp = client.post('/data/staffing-needs/exceptions',
                       json={'on_date': '2026-07-15', 'headcount': 1, 'note': 'x'})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_field'


# --- expansion + override rule ---

def test_expansion_applies_day_override(client):
    put_needs(client, WEEK_PATTERN)
    # Monday 2026-07-13 gets dated rows → they replace the recurring curve.
    client.post('/data/staffing-needs/exceptions',
                json={'on_date': '2026-07-13', 'start_minute': 480,
                      'end_minute': 600, 'headcount': 5})
    client.post('/data/staffing-needs/exceptions',
                json={'on_date': '2026-07-13', 'start_minute': 600,
                      'end_minute': 660, 'headcount': 4})
    body = expansion(client, '2026-W29')
    assert (body['from'], body['to']) == ('2026-07-13', '2026-07-19')
    assert body['configured'] is True
    monday = [i for i in body['intervals'] if i['date'] == '2026-07-13']
    assert [(i['headcount'], i['source']) for i in monday] == [(5, 'exception'), (4, 'exception')]
    saturday = [i for i in body['intervals'] if i['date'] == '2026-07-18']
    assert [(i['headcount'], i['source']) for i in saturday] == [(2, 'recurring')]


def test_deleting_last_exception_restores_recurrence(client):
    put_needs(client, WEEK_PATTERN)
    row = client.post('/data/staffing-needs/exceptions',
                      json={'on_date': '2026-07-13', 'headcount': 0}).get_json()
    monday = [i for i in expansion(client, '2026-W29')['intervals'] if i['date'] == '2026-07-13']
    assert [(i['headcount'], i['source']) for i in monday] == [(0, 'exception')]

    client.delete(f"/data/staffing-needs/exceptions/{row['id']}")
    monday = [i for i in expansion(client, '2026-W29')['intervals'] if i['date'] == '2026-07-13']
    assert [(i['headcount'], i['source']) for i in monday] == [(1, 'recurring'), (2, 'recurring')]


def test_configured_distinguishes_no_rows_from_closed_week(client):
    assert expansion(client, '2026-W29') == {
        'from': '2026-07-13', 'to': '2026-07-19', 'configured': False, 'intervals': []}
    # A single dated closed-day sentinel in ANOTHER week still flips
    # configured — the flag is org-global, not window-scoped.
    client.post('/data/staffing-needs/exceptions', json={'on_date': '2026-12-24', 'headcount': 0})
    body = expansion(client, '2026-W29')
    assert body['configured'] is True and body['intervals'] == []


def test_expansion_across_dst_week(client):
    # 2026-03-29 (Sunday of W13) is the spring-forward day in Stockholm:
    # wall clock 10:00 is 08:00Z instead of 09:00Z.
    put_needs(client, [{'weekday': 7, 'start_minute': 600, 'end_minute': 720, 'headcount': 1},
                       {'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1}])
    intervals = expansion(client, '2026-W13')['intervals']
    by_date = {i['date']: i for i in intervals}
    assert by_date['2026-03-23']['starts_at'] == '2026-03-23T09:00:00+00:00'
    assert by_date['2026-03-29']['starts_at'] == '2026-03-29T08:00:00+00:00'


def test_org_isolation(client):
    put_needs(client, WEEK_PATTERN)
    exc = client.post('/data/staffing-needs/exceptions',
                      json={'on_date': '2026-07-15', 'headcount': 1}).get_json()
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO organization (name) VALUES ('Needs other org') RETURNING id")
            other_org = str(cur.fetchone()[0])
            other_user = f'user_test_other_{other_org}'
            cur.execute('INSERT INTO org_user (user_id, org_id) VALUES (%s, %s)',
                        (other_user, other_org))
        conn.commit()
    try:
        app.config['TESTING'] = True
        other_client = app.test_client()
        other_client.environ_base['HTTP_X_TEST_USER'] = other_user
        assert other_client.get('/data/staffing-needs').get_json() == {'recurring': [], 'exceptions': []}
        # Another org can't delete our exception, and its PUT doesn't touch us.
        assert other_client.delete(f"/data/staffing-needs/exceptions/{exc['id']}").status_code == 404
        put_needs(other_client, [])
        assert len(client.get('/data/staffing-needs').get_json()['recurring']) == 3
    finally:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM organization WHERE id = %s', (other_org,))
            conn.commit()
