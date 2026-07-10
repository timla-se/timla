"""Tests for POST /compute/labor-cost (issue #17). Same DB-backed skip
pattern as test_api_data.py; fixtures from tests/conftest.py.

Month semantics mirror the week rule: org timezone, a shift belongs to
the month it starts in. Money math: Decimal, ROUND_HALF_UP, totals sum
the rounded row costs."""

import psycopg
import pytest

from app import app
from config import DATABASE_URL
from dbfixtures import db_available

pytestmark = pytest.mark.skipif(not db_available(), reason='no database reachable at DATABASE_URL')


def make_shift(client, staff_id, starts_at, ends_at):
    resp = client.post('/data/shifts', json={
        'staff_id': staff_id, 'starts_at': starts_at, 'ends_at': ends_at,
    })
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()['shift']


def report(client, period='2026-07'):
    resp = client.post('/compute/labor-cost', json={'period': period})
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def test_labor_cost_happy_path_two_staff(client, make_staff):
    anna = make_staff('Anna', hourly_wage=173.50)
    bella = make_staff('Bella', hourly_wage=150)
    # Anna 7.5 h, Bella 8 h (UTC instants; July Stockholm is UTC+2).
    make_shift(client, anna['id'], '2026-07-06T07:00:00+00:00', '2026-07-06T14:30:00+00:00')
    make_shift(client, bella['id'], '2026-07-07T07:00:00+00:00', '2026-07-07T15:00:00+00:00')

    body = report(client)
    assert body['period'] == '2026-07'
    assert [r['name'] for r in body['staff']] == ['Anna', 'Bella']
    anna_row, bella_row = body['staff']
    # 173.50 × 7.5 = 1301.25 exactly — no float artifacts.
    assert anna_row['hours'] == 7.5
    assert anna_row['hourly_wage'] == 173.50
    assert anna_row['cost'] == 1301.25
    assert anna_row['archived'] is False
    assert bella_row['cost'] == 1200.0
    assert body['totals'] == {
        'hours': 15.5, 'cost': 2501.25, 'uncosted_hours': 0.0, 'cost_complete': True,
    }


def test_labor_cost_shift_belongs_to_month_it_starts_in(client, make_staff):
    staff = make_staff(hourly_wage=100)
    # Starts 23:00 Stockholm time on June 30 (21:00 UTC), ends 07:00 July 1.
    # Belongs to June — with its full 8 h — and not to July.
    make_shift(client, staff['id'], '2026-06-30T21:00:00+00:00', '2026-07-01T05:00:00+00:00')
    # Starts 23:00 Stockholm time on July 31: belongs to July, full length.
    make_shift(client, staff['id'], '2026-07-31T21:00:00+00:00', '2026-08-01T05:00:00+00:00')

    june = report(client, '2026-06')
    assert june['totals']['hours'] == 8.0
    july = report(client, '2026-07')
    assert july['totals']['hours'] == 8.0
    assert report(client, '2026-08')['staff'] == []


def test_labor_cost_staff_without_wage_uncosted(client, make_staff):
    paid = make_staff('Paid', hourly_wage=100)
    unpaid = make_staff('Unpaid')
    make_shift(client, paid['id'], '2026-07-06T08:00:00+00:00', '2026-07-06T12:00:00+00:00')
    make_shift(client, unpaid['id'], '2026-07-06T08:00:00+00:00', '2026-07-06T14:00:00+00:00')

    body = report(client)
    unpaid_row = next(r for r in body['staff'] if r['name'] == 'Unpaid')
    assert unpaid_row['hours'] == 6.0
    assert unpaid_row['hourly_wage'] is None
    assert unpaid_row['cost'] is None
    assert body['totals'] == {
        'hours': 10.0, 'cost': 400.0, 'uncosted_hours': 6.0, 'cost_complete': False,
    }


def test_labor_cost_excludes_unassigned_shifts(client, make_staff):
    staff = make_staff(hourly_wage=100)
    shift = make_shift(client, staff['id'], '2026-07-06T08:00:00+00:00', '2026-07-06T12:00:00+00:00')
    client.patch(f"/data/shifts/{shift['id']}", json={'staff_id': None})
    assert report(client)['staff'] == []


def test_labor_cost_includes_archived_staff_with_shifts(client, make_staff):
    staff = make_staff(hourly_wage=100)
    make_shift(client, staff['id'], '2026-07-06T08:00:00+00:00', '2026-07-06T12:00:00+00:00')
    assert client.delete(f"/data/staff/{staff['id']}").status_code == 204

    body = report(client)
    assert len(body['staff']) == 1
    assert body['staff'][0]['archived'] is True
    assert body['staff'][0]['cost'] == 400.0


def test_labor_cost_omits_staff_without_shifts_in_period(client, make_staff):
    make_staff('Idle', hourly_wage=100)
    assert report(client)['staff'] == []


def test_labor_cost_org_isolation(client, make_staff):
    staff = make_staff(hourly_wage=100)
    make_shift(client, staff['id'], '2026-07-06T08:00:00+00:00', '2026-07-06T12:00:00+00:00')
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO organization (name) VALUES ('Other labor org') RETURNING id")
            other_org = str(cur.fetchone()[0])
            other_user = f'user_test_other_{other_org}'
            cur.execute('INSERT INTO org_user (user_id, org_id) VALUES (%s, %s)',
                        (other_user, other_org))
        conn.commit()
    try:
        app.config['TESTING'] = True
        other_client = app.test_client()
        other_client.environ_base['HTTP_X_TEST_USER'] = other_user
        assert report(other_client)['staff'] == []
    finally:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM organization WHERE id = %s', (other_org,))
            conn.commit()


def test_labor_cost_totals_sum_rounded_row_costs(client, make_staff):
    # 80 min = 1.333... h × 100.10 = 133.4666... → row cost 133.47.
    # Two rows: totals.cost is 266.94 (sum of rounded rows), not the
    # re-rounded raw sum 266.93 — the UI table must visibly add up.
    a = make_staff('A', hourly_wage=100.10)
    b = make_staff('B', hourly_wage=100.10)
    make_shift(client, a['id'], '2026-07-06T08:00:00+00:00', '2026-07-06T09:20:00+00:00')
    make_shift(client, b['id'], '2026-07-06T08:00:00+00:00', '2026-07-06T09:20:00+00:00')

    body = report(client)
    assert [r['cost'] for r in body['staff']] == [133.47, 133.47]
    assert body['totals']['cost'] == 266.94
    assert body['totals']['hours'] == 2.67  # 2.666... quantized once


def test_labor_cost_dst_fall_back_month_counts_real_hours(client, make_staff):
    staff = make_staff(hourly_wage=100)
    # 23:00 Oct 24 → 07:00 Oct 25 wall clock over the 2026-10-25 fall-back
    # night is 9 real hours (stored as UTC: 21:00 → 06:00).
    make_shift(client, staff['id'], '2026-10-24T21:00:00+00:00', '2026-10-25T06:00:00+00:00')
    body = report(client, '2026-10')
    assert body['staff'][0]['hours'] == 9.0
    assert body['staff'][0]['cost'] == 900.0


def test_labor_cost_missing_period(client):
    resp = client.post('/compute/labor-cost', json={})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'missing_period'


def test_labor_cost_unknown_field(client):
    resp = client.post('/compute/labor-cost', json={'period': '2026-07', 'extra': 1})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'unknown_field'


@pytest.mark.parametrize('bad', [None, 7, True, [], {}, '2026-7', '2026-13',
                                 '2026-W28', '2026-07-01', 'garbage'])
def test_labor_cost_invalid_period(client, bad):
    resp = client.post('/compute/labor-cost', json={'period': bad})
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'invalid_period'
