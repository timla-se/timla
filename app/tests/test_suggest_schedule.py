"""Generator tests (issue #11): the greedy engine through
POST /compute/suggest-schedule, plus the route contract. The engine is
best-effort — the pinned contract is zero hard conflicts, honest
`uncovered`, and determinism, not optimality."""

from datetime import datetime, timezone

import psycopg
import pytest

from app import app
from config import DATABASE_URL
from dbfixtures import db_available
from suggest import _uncovered

pytestmark = pytest.mark.skipif(not db_available(), reason='no database reachable at DATABASE_URL')

# 2026-W29: Monday 2026-07-13, Europe/Stockholm at CEST (UTC+2) all week.
WEEK = '2026-W29'
MONDAY = '2026-07-13'


def put_needs(client, recurring):
    resp = client.put('/data/staffing-needs', json={'recurring': recurring})
    assert resp.status_code == 200, resp.get_json()


def suggest(client, period=WEEK, expect=200):
    resp = client.post('/compute/suggest-schedule', json={'period': period})
    assert resp.status_code == expect, resp.get_json()
    return resp.get_json()


def create_shift(client, staff_id, starts_at, ends_at):
    resp = client.post('/data/shifts', json={
        'staff_id': staff_id, 'starts_at': starts_at, 'ends_at': ends_at,
    })
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()['shift']


def assert_zero_hard_conflicts(client, shifts):
    if not shifts:
        return
    resp = client.post('/compute/conflicts', json={'shifts': [
        {'staff_id': s['staff_id'], 'starts_at': s['starts_at'], 'ends_at': s['ends_at']}
        for s in shifts
    ]})
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()['conflicts'] == []


# --- engine behavior ---

def test_covers_a_coverable_curve_with_zero_hard_conflicts(client, make_staff):
    for name in ('Anna', 'Bea', 'Carl'):
        make_staff(name)
    # Mon 10–12: 1, 12–16: 2 (wall clock; CEST → 08:00Z / 10:00Z / 14:00Z).
    put_needs(client, [
        {'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1},
        {'weekday': 1, 'start_minute': 720, 'end_minute': 960, 'headcount': 2},
    ])
    body = suggest(client)
    assert body['period'] == WEEK
    assert body['uncovered'] == []
    assert body['shifts']
    assert_zero_hard_conflicts(client, body['shifts'])


def test_respects_hard_blocks(client, make_staff):
    blocked = make_staff('Blockerad')
    free = make_staff('Ledig')
    client.put(f"/data/availability/{blocked['id']}", json={
        'blocks': [{'weekday': 1, 'start_minute': 0, 'end_minute': 1440}], 'wishes': []})
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1}])
    body = suggest(client)
    assert body['uncovered'] == []
    assert {s['staff_id'] for s in body['shifts']} == {free['id']}


def test_respects_max_hours_across_days(client, make_staff):
    a = make_staff('A', max_hours_per_week=4)
    b = make_staff('B', max_hours_per_week=4)
    put_needs(client, [
        {'weekday': 1, 'start_minute': 600, 'end_minute': 840, 'headcount': 1},
        {'weekday': 2, 'start_minute': 600, 'end_minute': 840, 'headcount': 1},
    ])
    body = suggest(client)
    assert body['uncovered'] == []
    # 4 h each day: one staff member alone would break the cap.
    assert {s['staff_id'] for s in body['shifts']} == {a['id'], b['id']}
    assert_zero_hard_conflicts(client, body['shifts'])


def test_respects_min_rest(client, make_staff):
    client.put('/data/rules', json={'max_hours_per_week': None, 'min_rest_hours': 11})
    make_staff('Ensam')
    # Mon 10–12 and 20–22: only 8 h between — one person can't take both.
    put_needs(client, [
        {'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1},
        {'weekday': 1, 'start_minute': 1200, 'end_minute': 1320, 'headcount': 1},
    ])
    body = suggest(client)
    assert len(body['shifts']) == 1
    assert len(body['uncovered']) == 1
    assert body['uncovered'][0]['missing'] == 1
    assert_zero_hard_conflicts(client, body['shifts'])


def test_multi_headcount_gap_gets_multiple_staff(client, make_staff):
    a = make_staff('A')
    b = make_staff('B')
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 840, 'headcount': 2}])
    body = suggest(client)
    assert body['uncovered'] == []
    assert {s['staff_id'] for s in body['shifts']} == {a['id'], b['id']}


def test_prefers_wish_covered_staff(client, make_staff):
    wished = make_staff('Önskar')
    make_staff('Neutral')
    client.put(f"/data/availability/{wished['id']}", json={
        'wishes': [{'weekday': 1, 'start_minute': 540, 'end_minute': 1020}], 'blocks': []})
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1}])
    body = suggest(client)
    assert [s['staff_id'] for s in body['shifts']] == [wished['id']]


def test_deterministic_under_ties(client, make_staff):
    a = make_staff('Tvilling 1')
    b = make_staff('Tvilling 2')
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1}])
    first = suggest(client)
    second = suggest(client)
    assert first == second
    # The final tiebreak is staff_id, so the pick is the smaller UUID.
    assert first['shifts'][0]['staff_id'] == min(a['id'], b['id'])


def test_honest_uncovered_when_demand_exceeds_capacity(client, make_staff):
    make_staff('Ensam')
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 3}])
    body = suggest(client)
    assert len(body['shifts']) == 1
    assert body['uncovered'] == [{
        'date': MONDAY,
        'starts_at': f'{MONDAY}T08:00:00+00:00',
        'ends_at': f'{MONDAY}T10:00:00+00:00',
        'missing': 2,
    }]


def test_open_shifts_do_not_reduce_residual_need(client, make_staff):
    staff = make_staff()
    create_shift(client, None, f'{MONDAY}T08:00:00+00:00', f'{MONDAY}T10:00:00+00:00')
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1}])
    body = suggest(client)
    # The posted open slot covers no one — a real assignment is suggested.
    assert [s['staff_id'] for s in body['shifts']] == [staff['id']]
    assert body['uncovered'] == []


def test_saved_assigned_shifts_reduce_residual_need(client, make_staff):
    staff = make_staff()
    make_staff('Reserv')
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 840, 'headcount': 1}])
    # Saved 10:00–11:30 → only 11:30–14:00 is missing.
    create_shift(client, staff['id'], f'{MONDAY}T08:00:00+00:00', f'{MONDAY}T09:30:00+00:00')
    body = suggest(client)
    assert body['uncovered'] == []
    assert len(body['shifts']) == 1
    assert body['shifts'][0]['starts_at'] == f'{MONDAY}T09:30:00+00:00'
    assert body['shifts'][0]['ends_at'] == f'{MONDAY}T12:00:00+00:00'


def test_already_covered_week_suggests_nothing(client, make_staff):
    staff = make_staff()
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1}])
    create_shift(client, staff['id'], f'{MONDAY}T08:00:00+00:00', f'{MONDAY}T10:00:00+00:00')
    assert suggest(client) == {'period': WEEK, 'shifts': [], 'uncovered': [], 'warnings': []}


def test_no_needs_and_no_staff_edge_cases(client, make_staff):
    # No needs at all → nothing to do.
    assert suggest(client)['shifts'] == []
    assert suggest(client)['uncovered'] == []
    # Needs but no staff → empty suggestions, honestly uncovered.
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1}])
    body = suggest(client)
    assert body['shifts'] == []
    assert len(body['uncovered']) == 1


def test_partial_hour_needs_clamp_to_the_block(client, make_staff):
    make_staff()
    # 10:30–12:15 (105 min) — shorter than the 120 min minimum, so the
    # shift clamps to the need block instead of stretching past demand.
    put_needs(client, [{'weekday': 1, 'start_minute': 630, 'end_minute': 735, 'headcount': 1}])
    body = suggest(client)
    assert body['uncovered'] == []
    assert body['shifts'] == [{
        'staff_id': body['shifts'][0]['staff_id'],
        'starts_at': f'{MONDAY}T08:30:00+00:00',
        'ends_at': f'{MONDAY}T10:15:00+00:00',
    }]


def test_uncovered_recomputed_from_surviving_set():
    # Pure unit check of the post-filter contract: uncovered is derived from
    # whatever proposals SURVIVE, never from the pre-drop set.
    def utc(h, m=0):
        return datetime(2026, 7, 13, h, m, tzinfo=timezone.utc)

    needs = [{'date': MONDAY, 'starts_at': utc(8), 'ends_at': utc(12), 'headcount': 1}]
    survivor = [{'staff_id': 'x', 'starts_at': utc(8), 'ends_at': utc(10)}]
    assert _uncovered(needs, [], survivor) == [
        {'date': MONDAY, 'starts_at': utc(10), 'ends_at': utc(12), 'missing': 1}]
    # If the same proposal had been dropped, the whole block is uncovered.
    assert _uncovered(needs, [], []) == [
        {'date': MONDAY, 'starts_at': utc(8), 'ends_at': utc(12), 'missing': 1}]


# --- route contract ---

def test_rejects_ranges_unknown_fields_and_malformed_weeks(client):
    resp = client.post('/compute/suggest-schedule', json={'from': '2026-07-13', 'to': '2026-07-19'})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_field'
    assert client.post('/compute/suggest-schedule', json={'period': 'juli'}).status_code == 400
    assert client.post('/compute/suggest-schedule', json={'period': '2026-W60'}).status_code == 400
    assert client.post('/compute/suggest-schedule', json={'period': 28}).status_code == 400
    assert client.post('/compute/suggest-schedule', json={}).status_code == 400
    resp = client.post('/compute/suggest-schedule', json={'period': WEEK, 'apply': True})
    assert resp.status_code == 400


def test_purity_two_calls_no_db_delta(client, make_staff):
    make_staff()
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1}])

    def counts():
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT count(*) FROM shift')
                shifts = cur.fetchone()[0]
                cur.execute('SELECT count(*) FROM staffing_need')
                needs = cur.fetchone()[0]
        return shifts, needs

    before = counts()
    first = suggest(client)
    second = suggest(client)
    assert first == second
    assert counts() == before
    assert first['shifts']  # it did suggest something, purely


def test_org_scoping(client, make_staff):
    make_staff()
    put_needs(client, [{'weekday': 1, 'start_minute': 600, 'end_minute': 720, 'headcount': 1}])
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO organization (name) VALUES ('Suggest other org') RETURNING id")
            other_org = str(cur.fetchone()[0])
            other_user = f'user_test_other_{other_org}'
            cur.execute('INSERT INTO org_user (user_id, org_id) VALUES (%s, %s)',
                        (other_user, other_org))
        conn.commit()
    try:
        app.config['TESTING'] = True
        other_client = app.test_client()
        other_client.environ_base['HTTP_X_TEST_USER'] = other_user
        # The other org has no needs and no staff — nothing leaks across.
        assert suggest(other_client) == {'period': WEEK, 'shifts': [], 'uncovered': [], 'warnings': []}
    finally:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM organization WHERE id = %s', (other_org,))
            conn.commit()
