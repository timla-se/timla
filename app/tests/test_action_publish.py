"""Tests for POST /action/publish (issue #10): snapshot correctness, the
non-overlap invariant (overwrite/trim/split), body validation, and the
per-org advisory-lock concurrency story. Same DB-skip pattern as
test_schema.py; org/client/make_staff fixtures live in tests/conftest.py.

Fixed dates: 2026-W28 = Mon 2026-07-06, W29 = 07-13, W30 = 07-20. The test
org's timezone is Europe/Stockholm (CEST in July, UTC+2), so a local week
[Mon 00:00, next Mon 00:00) is UTC [Sun 22:00Z, Sun 22:00Z).
"""

import threading

import psycopg
import pytest

from app import app
from config import DATABASE_URL
from dbfixtures import db_available

pytestmark = pytest.mark.skipif(not db_available(), reason='no database reachable at DATABASE_URL')


def _mk_shift(client, staff_id, starts, ends, note=None):
    resp = client.post('/data/shifts', json={
        'staff_id': staff_id, 'starts_at': starts, 'ends_at': ends, 'note': note})
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()['shift']


def _rows(org_id):
    with psycopg.connect(DATABASE_URL, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT * FROM publication WHERE org_id = %s ORDER BY period_start',
                        (org_id,))
            return cur.fetchall()


# --- auth + validation ---

def test_publish_requires_auth(org_id):
    resp = app.test_client().post('/action/publish', json={'period': '2026-W28'})
    assert resp.status_code == 401


@pytest.mark.parametrize('body', [
    {},                                                          # missing period
    {'period': 'vecka-28'},                                      # malformed week
    {'from': '2026-07-10', 'to': '2026-07-06'},                  # to before from
    {'from': '2026-07-06'},                                      # from without to
    {'from': '2026-01-01', 'to': '2027-01-02'},                  # over the one-year cap
    {'period': '2026-W28', 'from': '2026-07-06', 'to': '2026-07-12'},  # both forms
    {'period': '2026-W28', 'notify': True},                      # unknown field
    # JSON-typed garbage must be a 400, never a 500
    {'period': 5},
    {'period': ['2026-W28']},
    {'period': None},
    {'from': 5, 'to': 6},
    {'from': '2026-07-06', 'to': ['2026-07-12']},
])
def test_publish_validation_400(client, body):
    resp = client.post('/action/publish', json=body)
    assert resp.status_code == 400, (body, resp.get_json())


# --- snapshot correctness ---

def test_snapshot_captures_shifts_starting_in_period(client, make_staff, org_id):
    staff = make_staff()
    # Starts on the period's last local day (Sun 23:30 local) — in, despite
    # ending after the period.
    overnight = _mk_shift(client, staff['id'],
                          '2026-07-26T21:30:00+00:00', '2026-07-27T04:00:00+00:00',
                          note='stängning')
    # Ends inside the period's first day but starts before it (Sun W29 local) — out.
    _mk_shift(client, staff['id'], '2026-07-19T20:00:00+00:00', '2026-07-20T02:00:00+00:00')
    # Open shift (no staff) inside the period — included in the snapshot.
    open_shift = _mk_shift(client, None, '2026-07-21T10:00:00+00:00', '2026-07-21T14:00:00+00:00')

    resp = client.post('/action/publish', json={'period': '2026-W30'})
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body['from'] == '2026-07-20' and body['to'] == '2026-07-26'  # inclusive to
    assert body['shift_count'] == 2
    assert body['published_at']

    (row,) = _rows(org_id)
    by_id = {s['id']: s for s in row['shifts']}
    assert set(by_id) == {overnight['id'], open_shift['id']}
    assert by_id[overnight['id']]['note'] == 'stängning'
    assert by_id[overnight['id']]['staff_id'] == staff['id']
    assert by_id[open_shift['id']]['staff_id'] is None


def test_republish_same_range_overwrites(client, make_staff, org_id):
    staff = make_staff()
    assert client.post('/action/publish', json={'period': '2026-W28'}).get_json()['shift_count'] == 0
    _mk_shift(client, staff['id'], '2026-07-07T08:00:00+00:00', '2026-07-07T12:00:00+00:00')
    assert client.post('/action/publish', json={'period': '2026-W28'}).get_json()['shift_count'] == 1
    rows = _rows(org_id)
    assert len(rows) == 1
    assert len(rows[0]['shifts']) == 1


def test_empty_publish_is_a_retraction(client, make_staff, org_id):
    staff = make_staff()
    shift = _mk_shift(client, staff['id'], '2026-07-07T08:00:00+00:00', '2026-07-07T12:00:00+00:00')
    assert client.post('/action/publish', json={'period': '2026-W28'}).get_json()['shift_count'] == 1
    client.delete(f"/data/shifts/{shift['id']}")
    resp = client.post('/action/publish', json={'period': '2026-W28'})
    assert resp.get_json()['shift_count'] == 0
    (row,) = _rows(org_id)
    assert row['shifts'] == []  # published and empty ≠ unpublished


# --- non-overlap invariant: overwrite / trim / split ---

def test_partial_republish_trims_remainder(client, make_staff, org_id):
    staff = make_staff()
    in_w28 = _mk_shift(client, staff['id'], '2026-07-07T08:00:00+00:00', '2026-07-07T12:00:00+00:00')
    in_w29 = _mk_shift(client, staff['id'], '2026-07-14T08:00:00+00:00', '2026-07-14T12:00:00+00:00')

    first = client.post('/action/publish', json={'from': '2026-07-06', 'to': '2026-07-19'}).get_json()
    assert first['shift_count'] == 2

    second = client.post('/action/publish', json={'period': '2026-W28'}).get_json()
    assert second['shift_count'] == 1

    rows = _rows(org_id)
    assert [(r['period_start'].isoformat(), r['period_end'].isoformat()) for r in rows] == [
        ('2026-07-06', '2026-07-13'),  # the new W28 publish
        ('2026-07-13', '2026-07-20'),  # trimmed remainder of the first publish
    ]
    new_row, remainder = rows
    assert [s['id'] for s in new_row['shifts']] == [in_w28['id']]
    assert [s['id'] for s in remainder['shifts']] == [in_w29['id']]
    # the remainder is a remnant of the old publish, not a new one
    assert remainder['published_at'].isoformat() == first['published_at']
    assert new_row['published_at'].isoformat() == second['published_at']


def test_republish_middle_splits_in_two(client, make_staff, org_id):
    staff = make_staff()
    ids = [
        _mk_shift(client, staff['id'], f'2026-07-{d}T08:00:00+00:00', f'2026-07-{d}T12:00:00+00:00')['id']
        for d in ('07', '14', '21')  # one shift in each of W28, W29, W30
    ]
    first = client.post('/action/publish', json={'from': '2026-07-06', 'to': '2026-07-26'}).get_json()
    assert first['shift_count'] == 3

    assert client.post('/action/publish', json={'period': '2026-W29'}).status_code == 200

    rows = _rows(org_id)
    assert [(r['period_start'].isoformat(), r['period_end'].isoformat()) for r in rows] == [
        ('2026-07-06', '2026-07-13'),  # left fragment
        ('2026-07-13', '2026-07-20'),  # the new W29 publish
        ('2026-07-20', '2026-07-27'),  # right fragment
    ]
    left, middle, right = rows
    assert [s['id'] for s in left['shifts']] == [ids[0]]
    assert [s['id'] for s in middle['shifts']] == [ids[1]]
    assert [s['id'] for s in right['shifts']] == [ids[2]]
    # fragments keep the original published_at; the middle is new
    assert left['published_at'].isoformat() == first['published_at']
    assert right['published_at'].isoformat() == first['published_at']
    assert middle['published_at'].isoformat() != first['published_at']


def test_fully_covered_publication_is_replaced(client, make_staff, org_id):
    assert client.post('/action/publish', json={'period': '2026-W29'}).status_code == 200
    # a wider publish swallows the narrower one entirely
    assert client.post('/action/publish',
                       json={'from': '2026-07-06', 'to': '2026-07-26'}).status_code == 200
    rows = _rows(org_id)
    assert [(r['period_start'].isoformat(), r['period_end'].isoformat()) for r in rows] == [
        ('2026-07-06', '2026-07-27'),
    ]


# --- concurrency: the per-org advisory lock serializes publishes ---

def test_concurrent_overlapping_publishes_serialize(org_id):
    def make_client():
        app.config['TESTING'] = True
        c = app.test_client()
        c.environ_base['HTTP_X_TEST_USER'] = f'user_test_{org_id}'
        return c

    statuses = []

    def publish(frm, to):
        resp = make_client().post('/action/publish', json={'from': frm, 'to': to})
        statuses.append(resp.status_code)

    threads = [
        threading.Thread(target=publish, args=('2026-07-06', '2026-07-12')),
        threading.Thread(target=publish, args=('2026-07-09', '2026-07-15')),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # The advisory lock serializes them: both succeed, no ExclusionViolation
    # leaks as a 500, and the loser of the race is trimmed.
    assert statuses == [200, 200]
    rows = _rows(org_id)
    assert len(rows) == 2
    for a, b in zip(rows, rows[1:]):
        assert a['period_end'] <= b['period_start']  # no overlap
