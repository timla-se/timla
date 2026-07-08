"""API tests for the /data primitives. Need a migrated database (same skip
pattern as test_schema.py); org/client/make_staff fixtures live in
tests/conftest.py."""

import psycopg
import pytest

from app import app
from config import DATABASE_URL
from dbfixtures import db_available

pytestmark = pytest.mark.skipif(not db_available(), reason='no database reachable at DATABASE_URL')


# --- staff ---

def test_staff_requires_auth(org_id):
    resp = app.test_client().get('/data/staff')
    assert resp.status_code == 401
    assert resp.get_json()['error'] == 'unauthenticated'


def test_staff_crud_roundtrip(client, make_staff):
    staff = make_staff(role='kock', max_hours_per_week=32)
    assert staff['max_hours_per_week'] == 32

    listed = client.get('/data/staff').get_json()
    assert [s['id'] for s in listed] == [staff['id']]

    resp = client.patch(f"/data/staff/{staff['id']}", json={'role': 'servis'})
    assert resp.get_json()['role'] == 'servis'

    assert client.delete(f"/data/staff/{staff['id']}").status_code == 204
    assert client.get('/data/staff').get_json() == []
    archived = client.get('/data/staff?include_archived=1').get_json()
    assert archived[0]['archived'] is True


def test_staff_rejects_unknown_fields(client):
    resp = client.post('/data/staff', json={'name': 'X', 'hourly_wage': 200})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_field'


def test_org_isolation(client, make_staff):
    staff = make_staff()
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO organization (name) VALUES ('Other API org') RETURNING id")
            other_org = str(cur.fetchone()[0])
            other_user = f'user_test_other_{other_org}'
            cur.execute(
                'INSERT INTO org_user (user_id, org_id) VALUES (%s, %s)',
                (other_user, other_org),
            )
        conn.commit()
    try:
        app.config['TESTING'] = True
        other_client = app.test_client()
        other_client.environ_base['HTTP_X_TEST_USER'] = other_user
        assert other_client.get('/data/staff').get_json() == []
        assert other_client.patch(f"/data/staff/{staff['id']}", json={'role': 'x'}).status_code == 404
    finally:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM organization WHERE id = %s', (other_org,))
            conn.commit()


# --- availability ---

def test_availability_document_and_exceptions(client, make_staff):
    staff = make_staff()
    resp = client.put(f"/data/availability/{staff['id']}", json={
        'wishes': [{'weekday': 1, 'start_minute': 540, 'end_minute': 1020}],
        'blocks': [{'weekday': 7, 'start_minute': 0, 'end_minute': 1440}],
    })
    assert resp.status_code == 200
    doc = resp.get_json()
    assert len(doc['wishes']) == 1 and len(doc['blocks']) == 1

    resp = client.post(f"/data/availability/{staff['id']}/exceptions", json={'on_date': '2026-07-15'})
    assert resp.status_code == 201
    exception = resp.get_json()
    assert (exception['start_minute'], exception['end_minute']) == (0, 1440)

    # PUT replaces patterns but must not touch dated exceptions.
    client.put(f"/data/availability/{staff['id']}", json={'wishes': [], 'blocks': []})
    doc = client.get(f"/data/availability/{staff['id']}").get_json()
    assert doc['wishes'] == [] and doc['blocks'] == []
    assert len(doc['exceptions']) == 1

    resp = client.delete(f"/data/availability/{staff['id']}/exceptions/{exception['id']}")
    assert resp.status_code == 204


def test_availability_expansion_over_period(client, make_staff):
    staff = make_staff()
    client.put(f"/data/availability/{staff['id']}", json={
        'wishes': [{'weekday': 1, 'start_minute': 480, 'end_minute': 960}],  # Mondays 08-16
    })
    client.post(f"/data/availability/{staff['id']}/exceptions", json={'on_date': '2026-07-15'})  # Wed W29

    resp = client.get(f"/data/availability/{staff['id']}?period=2026-W29")
    body = resp.get_json()
    kinds = [(i['date'], i['kind'], i['source']) for i in body['intervals']]
    assert ('2026-07-13', 'wish', 'recurring') in kinds
    assert ('2026-07-15', 'block', 'exception') in kinds
    # Summer: Monday 08:00 Stockholm is 06:00 UTC.
    monday_wish = next(i for i in body['intervals'] if i['kind'] == 'wish')
    assert monday_wish['starts_at'].startswith('2026-07-13T06:00')


def test_availability_rejects_wish_without_weekday(client, make_staff):
    staff = make_staff()
    resp = client.put(f"/data/availability/{staff['id']}", json={
        'wishes': [{'start_minute': 0, 'end_minute': 60}],
    })
    assert resp.status_code == 400


# --- shifts ---

def test_shift_crud_and_week_filter(client, make_staff):
    staff = make_staff()
    # Saturday 18:00 → Sunday 02:00 Stockholm time, W28.
    resp = client.post('/data/shifts', json={
        'staff_id': staff['id'],
        'starts_at': '2026-07-11T16:00:00+00:00',
        'ends_at': '2026-07-12T00:00:00+00:00',
    })
    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    assert body['conflicts'] == [] and body['warnings'] == []
    shift = body['shift']

    in_week = client.get('/data/shifts?period=2026-W28').get_json()
    assert [s['id'] for s in in_week] == [shift['id']]
    assert client.get('/data/shifts?period=2026-W29').get_json() == []

    resp = client.patch(f"/data/shifts/{shift['id']}", json={'staff_id': None, 'note': 'öppet pass'})
    patched = resp.get_json()['shift']
    assert patched['staff_id'] is None and patched['note'] == 'öppet pass'

    assert client.delete(f"/data/shifts/{shift['id']}").status_code == 204
    assert client.delete(f"/data/shifts/{shift['id']}").status_code == 404


def test_shift_requires_period_on_list(client):
    resp = client.get('/data/shifts')
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'missing_period'


def test_shift_rejects_bad_input(client, make_staff):
    staff = make_staff()
    base = {'staff_id': staff['id'], 'starts_at': '2026-07-11T16:00:00+00:00'}
    # end before start
    resp = client.post('/data/shifts', json={**base, 'ends_at': '2026-07-11T15:00:00+00:00'})
    assert resp.status_code == 400
    # naive timestamp
    resp = client.post('/data/shifts', json={**base, 'ends_at': '2026-07-11T20:00:00'})
    assert resp.status_code == 400
    # staff from another org (nonexistent uuid)
    resp = client.post('/data/shifts', json={
        'staff_id': '00000000-0000-0000-0000-000000000000',
        'starts_at': '2026-07-11T16:00:00+00:00',
        'ends_at': '2026-07-11T20:00:00+00:00',
    })
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_staff'


# --- input validation regressions (PR #18 review) ---

def test_staff_rejects_non_string_name_and_bool_hours(client):
    assert client.post('/data/staff', json={'name': 123}).status_code == 400
    assert client.post('/data/staff', json={'name': True}).status_code == 400
    assert client.post('/data/staff', json={'name': 'X', 'max_hours_per_week': True}).status_code == 400


def test_staff_archived_must_be_boolean(client, make_staff):
    staff = make_staff()
    for bad in ('no', 'false', 0, None):
        resp = client.patch(f"/data/staff/{staff['id']}", json={'archived': bad})
        assert resp.status_code == 400, f'archived={bad!r} accepted'
    # and the staff member is still active
    assert client.get('/data/staff').get_json()[0]['archived'] is False


def test_staff_create_rejects_archived_field(client):
    resp = client.post('/data/staff', json={'name': 'X', 'archived': True})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_field'


def test_shift_rejects_non_string_staff_id(client):
    resp = client.post('/data/shifts', json={
        'staff_id': 123,
        'starts_at': '2026-07-11T16:00:00+00:00',
        'ends_at': '2026-07-11T20:00:00+00:00',
    })
    assert resp.status_code == 400


def test_shift_rejects_archived_staff(client, make_staff):
    staff = make_staff()
    client.delete(f"/data/staff/{staff['id']}")
    resp = client.post('/data/shifts', json={
        'staff_id': staff['id'],
        'starts_at': '2026-07-11T16:00:00+00:00',
        'ends_at': '2026-07-11T20:00:00+00:00',
    })
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'archived_staff'


def test_availability_rejects_bool_weekday_and_unknown_exception_fields(client, make_staff):
    staff = make_staff()
    resp = client.put(f"/data/availability/{staff['id']}", json={
        'wishes': [{'weekday': True, 'start_minute': 0, 'end_minute': 60}],
    })
    assert resp.status_code == 400
    # typo'd field must not silently create a full-day block
    resp = client.post(f"/data/availability/{staff['id']}/exceptions",
                       json={'on_date': '2026-07-15', 'end_minutes': 600})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_field'


def test_rules_rejects_boolean(client):
    resp = client.put('/data/rules', json={'max_hours_per_week': True})
    assert resp.status_code == 400


def test_period_range_is_capped(client):
    resp = client.get('/data/shifts?from=0001-01-01&to=9999-12-31')
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'invalid_period'


# --- actions: share-link tokens ---

def test_regenerate_link_generates_and_replaces_token(client, make_staff):
    staff = make_staff()
    assert staff['share_token'] is None
    first = client.post(f"/action/staff/{staff['id']}/regenerate-link")
    assert first.status_code == 200
    token1 = first.get_json()['share_token']
    assert token1
    token2 = client.post(f"/action/staff/{staff['id']}/regenerate-link").get_json()['share_token']
    assert token2 and token2 != token1
    # persisted on the staff row
    listed = client.get('/data/staff').get_json()
    assert listed[0]['share_token'] == token2


def test_regenerate_link_rejects_archived_and_unknown_staff(client, make_staff):
    staff = make_staff()
    client.delete(f"/data/staff/{staff['id']}")
    resp = client.post(f"/action/staff/{staff['id']}/regenerate-link")
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'archived_staff'
    resp = client.post('/action/staff/00000000-0000-0000-0000-000000000000/regenerate-link')
    assert resp.status_code == 404


# --- org ---

def test_org_read(client, org_id):
    assert app.test_client().get('/data/org').status_code == 401
    resp = client.get('/data/org')
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['id'] == org_id
    assert body['name'] == 'API-testorg'
    assert body['timezone']


# --- publications ---

def test_publications_read(client, org_id):
    assert app.test_client().get('/data/publications?period=2026-W28').status_code == 401
    assert client.get('/data/publications').status_code == 400
    assert client.get('/data/publications?period=vecka-28').status_code == 400
    assert client.get('/data/publications?period=2026-W99').status_code == 400

    assert client.get('/data/publications?period=2026-W28').get_json() is None

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO publication (org_id, week, shifts) VALUES (%s, '2026-W28', '[]')",
                (org_id,),
            )
        conn.commit()
    body = client.get('/data/publications?period=2026-W28').get_json()
    assert body['week'] == '2026-W28'
    assert body['published_at']
    # Other weeks stay unpublished
    assert client.get('/data/publications?period=2026-W29').get_json() is None


# --- rules ---

def test_rules_roundtrip(client):
    assert client.get('/data/rules').get_json() == {'max_hours_per_week': None, 'min_rest_hours': None}
    resp = client.put('/data/rules', json={'max_hours_per_week': 40, 'min_rest_hours': 11})
    assert resp.get_json() == {'max_hours_per_week': 40.0, 'min_rest_hours': 11.0}
    resp = client.put('/data/rules', json={'max_hours_per_week': 38.5})
    assert resp.get_json() == {'max_hours_per_week': 38.5, 'min_rest_hours': None}
