"""Conflict engine tests through /compute/conflicts and the /data/shifts
enforcement (issue #5). Cover every conflict type, DST and week-boundary
edge cases, and violations only visible against saved shifts outside the
payload."""

import pytest

from dbfixtures import db_available

pytestmark = pytest.mark.skipif(not db_available(), reason='no database reachable at DATABASE_URL')


def check(client, shifts):
    resp = client.post('/compute/conflicts', json={'shifts': shifts})
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def create_shift(client, staff_id, starts_at, ends_at):
    resp = client.post('/data/shifts', json={
        'staff_id': staff_id, 'starts_at': starts_at, 'ends_at': ends_at,
    })
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()['shift']


def conflict_types(result):
    return sorted({c['type'] for c in result['conflicts']})


def test_double_booking_against_saved_shift_outside_payload(client, make_staff):
    staff = make_staff()
    create_shift(client, staff['id'], '2026-07-13T10:00:00+00:00', '2026-07-13T14:00:00+00:00')
    result = check(client, [{
        'staff_id': staff['id'],
        'starts_at': '2026-07-13T13:00:00+00:00',
        'ends_at': '2026-07-13T17:00:00+00:00',
    }])
    assert conflict_types(result) == ['double_booking']


def test_double_booking_within_payload(client, make_staff):
    staff = make_staff()
    result = check(client, [
        {'staff_id': staff['id'], 'starts_at': '2026-07-13T10:00:00+00:00', 'ends_at': '2026-07-13T14:00:00+00:00'},
        {'staff_id': staff['id'], 'starts_at': '2026-07-13T13:00:00+00:00', 'ends_at': '2026-07-13T17:00:00+00:00'},
    ])
    assert conflict_types(result) == ['double_booking']
    assert {c['shift_index'] for c in result['conflicts']} == {0, 1}


def test_proposed_replaces_its_saved_counterpart(client, make_staff):
    staff = make_staff()
    saved = create_shift(client, staff['id'], '2026-07-13T10:00:00+00:00', '2026-07-13T14:00:00+00:00')
    result = check(client, [{
        'id': saved['id'],
        'staff_id': staff['id'],
        'starts_at': '2026-07-13T11:00:00+00:00',
        'ends_at': '2026-07-13T15:00:00+00:00',
    }])
    assert result['conflicts'] == []


def test_overnight_shift_hits_sunday_block(client, make_staff):
    staff = make_staff()
    client.put(f"/data/availability/{staff['id']}", json={
        'blocks': [{'weekday': 7, 'start_minute': 0, 'end_minute': 1440}],
    })
    # Saturday 18:00 → Sunday 02:00 Stockholm: the tail overlaps the Sunday block.
    result = check(client, [{
        'staff_id': staff['id'],
        'starts_at': '2026-07-11T16:00:00+00:00',
        'ends_at': '2026-07-12T00:00:00+00:00',
    }])
    assert conflict_types(result) == ['blocked']


def test_dated_block_on_dst_transition_day(client, make_staff):
    staff = make_staff()
    # 2026-03-29 is the spring-forward day; block 08:00-16:00 wall clock.
    client.post(f"/data/availability/{staff['id']}/exceptions",
                json={'on_date': '2026-03-29', 'start_minute': 480, 'end_minute': 960})
    # 06:00Z = 08:00 CEST after the transition → must overlap.
    result = check(client, [{
        'staff_id': staff['id'],
        'starts_at': '2026-03-29T06:00:00+00:00',
        'ends_at': '2026-03-29T07:00:00+00:00',
    }])
    assert conflict_types(result) == ['blocked']


def test_max_hours_uses_stricter_cap_and_counts_saved_shifts(client, make_staff):
    client.put('/data/rules', json={'max_hours_per_week': 40})
    staff = make_staff(max_hours_per_week=10)  # stricter than the org rule
    create_shift(client, staff['id'], '2026-07-13T08:00:00+00:00', '2026-07-13T16:00:00+00:00')  # 8 h saved
    over = check(client, [{
        'staff_id': staff['id'],
        'starts_at': '2026-07-15T08:00:00+00:00',
        'ends_at': '2026-07-15T12:00:00+00:00',  # 4 h → 12 h total in W29
    }])
    assert conflict_types(over) == ['max_hours']
    assert over['conflicts'][0]['effective_max'] == 10.0
    # Same 4 h in the next week is fine.
    clean = check(client, [{
        'staff_id': staff['id'],
        'starts_at': '2026-07-22T08:00:00+00:00',
        'ends_at': '2026-07-22T12:00:00+00:00',
    }])
    assert clean['conflicts'] == []


def test_rest_violation_across_week_boundary(client, make_staff):
    client.put('/data/rules', json={'min_rest_hours': 11})
    staff = make_staff()
    # Saved: Monday W30 06:00-14:00 Stockholm.
    create_shift(client, staff['id'], '2026-07-20T04:00:00+00:00', '2026-07-20T12:00:00+00:00')
    # Proposed: Sunday W29 19:00-23:00 Stockholm → only 7 h rest before Monday 06:00.
    result = check(client, [{
        'staff_id': staff['id'],
        'starts_at': '2026-07-19T17:00:00+00:00',
        'ends_at': '2026-07-19T21:00:00+00:00',
    }])
    assert conflict_types(result) == ['insufficient_rest']


def test_wishes_warn_softly_and_only_when_wishes_exist(client, make_staff):
    staff = make_staff()
    anytime = [{'staff_id': staff['id'],
                'starts_at': '2026-07-13T06:00:00+00:00',
                'ends_at': '2026-07-13T07:00:00+00:00'}]
    # No wishes registered → all time is neutral, no warning.
    assert check(client, anytime)['warnings'] == []

    client.put(f"/data/availability/{staff['id']}", json={
        'wishes': [{'weekday': 1, 'start_minute': 540, 'end_minute': 1020}],  # Mon 09-17
    })
    result = check(client, anytime)  # 08:00-09:00 local: before the wish window
    assert [w['type'] for w in result['warnings']] == ['outside_wishes']
    assert result['conflicts'] == []
    # Fully inside the wish window → silent.
    inside = check(client, [{'staff_id': staff['id'],
                             'starts_at': '2026-07-13T08:00:00+00:00',
                             'ends_at': '2026-07-13T12:00:00+00:00'}])
    assert inside['warnings'] == []


def test_open_shifts_have_no_conflicts(client, make_staff):
    make_staff()
    result = check(client, [{'staff_id': None,
                             'starts_at': '2026-07-13T06:00:00+00:00',
                             'ends_at': '2026-07-13T14:00:00+00:00'}])
    assert result == {'conflicts': [], 'warnings': []}


def test_compute_rejects_unknown_staff(client):
    resp = client.post('/compute/conflicts', json={'shifts': [{
        'staff_id': '00000000-0000-0000-0000-000000000000',
        'starts_at': '2026-07-13T06:00:00+00:00',
        'ends_at': '2026-07-13T14:00:00+00:00',
    }]})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_staff'


# --- regressions from PR #19 review ---

def test_rest_checks_running_max_not_just_adjacent_shift(client, make_staff):
    client.put('/data/rules', json={'min_rest_hours': 11})
    staff = make_staff()
    # Mon 08:00-22:00, plus a contained Mon 09:00-10:00 forced on top.
    create_shift(client, staff['id'], '2026-07-13T06:00:00+00:00', '2026-07-13T20:00:00+00:00')
    forced = client.post('/data/shifts?force=true', json={
        'staff_id': staff['id'],
        'starts_at': '2026-07-13T07:00:00+00:00',
        'ends_at': '2026-07-13T08:00:00+00:00',
    })
    assert forced.status_code == 201
    # Tue 08:30 start: 10.5 h after the 22:00 end — the contained shift's
    # earlier end must not mask the violation.
    result = check(client, [{
        'staff_id': staff['id'],
        'starts_at': '2026-07-14T06:30:00+00:00',
        'ends_at': '2026-07-14T10:00:00+00:00',
    }])
    assert 'insufficient_rest' in conflict_types(result)


def test_unassigning_proposal_replaces_its_saved_counterpart(client, make_staff):
    staff = make_staff()
    saved = create_shift(client, staff['id'], '2026-07-13T10:00:00+00:00', '2026-07-13T14:00:00+00:00')
    # One proposal unassigns the saved shift, another gives the same person
    # the same slot — no double booking, the saved version is being replaced.
    result = check(client, [
        {'id': saved['id'], 'staff_id': None,
         'starts_at': '2026-07-13T10:00:00+00:00', 'ends_at': '2026-07-13T14:00:00+00:00'},
        {'staff_id': staff['id'],
         'starts_at': '2026-07-13T10:00:00+00:00', 'ends_at': '2026-07-13T14:00:00+00:00'},
    ])
    assert result['conflicts'] == []


def test_compute_flags_new_shifts_for_archived_staff(client, make_staff):
    staff = make_staff()
    client.delete(f"/data/staff/{staff['id']}")
    result = check(client, [{
        'staff_id': staff['id'],
        'starts_at': '2026-07-13T10:00:00+00:00',
        'ends_at': '2026-07-13T14:00:00+00:00',
    }])
    assert conflict_types(result) == ['archived_staff']


def test_note_only_patch_does_not_retrigger_enforcement(client, make_staff):
    staff = make_staff()
    client.put(f"/data/availability/{staff['id']}", json={
        'blocks': [{'weekday': 7, 'start_minute': 0, 'end_minute': 1440}],
    })
    forced = client.post('/data/shifts?force=true', json={
        'staff_id': staff['id'],
        'starts_at': '2026-07-12T08:00:00+00:00',
        'ends_at': '2026-07-12T12:00:00+00:00',
    })
    shift = forced.get_json()['shift']
    resp = client.patch(f"/data/shifts/{shift['id']}", json={'note': 'godkänt undantag'})
    assert resp.status_code == 200
    assert resp.get_json()['shift']['note'] == 'godkänt undantag'
    # Changing the times still re-triggers enforcement.
    resp = client.patch(f"/data/shifts/{shift['id']}", json={
        'starts_at': '2026-07-12T09:00:00+00:00',
        'ends_at': '2026-07-12T13:00:00+00:00',
    })
    assert resp.status_code == 409


# --- enforcement on /data/shifts ---

def test_write_rejects_hard_conflicts_unless_forced(client, make_staff):
    staff = make_staff()
    client.put(f"/data/availability/{staff['id']}", json={
        'blocks': [{'weekday': 7, 'start_minute': 0, 'end_minute': 1440}],
    })
    sunday = {'staff_id': staff['id'],
              'starts_at': '2026-07-12T08:00:00+00:00',
              'ends_at': '2026-07-12T12:00:00+00:00'}

    resp = client.post('/data/shifts', json=sunday)
    assert resp.status_code == 409
    body = resp.get_json()
    assert body['error'] == 'conflict'
    assert [c['type'] for c in body['conflicts']] == ['blocked']
    assert client.get('/data/shifts?period=2026-W28').get_json() == []

    forced = client.post('/data/shifts?force=true', json=sunday)
    assert forced.status_code == 201
    assert [c['type'] for c in forced.get_json()['conflicts']] == ['blocked']

    # PATCH is guarded the same way: moving a clean Tuesday shift into the block.
    tuesday = create_shift(client, staff['id'], '2026-07-14T08:00:00+00:00', '2026-07-14T12:00:00+00:00')
    resp = client.patch(f"/data/shifts/{tuesday['id']}", json={
        'starts_at': '2026-07-19T08:00:00+00:00',
        'ends_at': '2026-07-19T12:00:00+00:00',
    })
    assert resp.status_code == 409
