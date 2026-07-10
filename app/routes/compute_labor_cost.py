"""/compute/labor-cost — monthly scheduled hours × hourly wage (issue #17).

Pure: reads only, any number of calls never changes state. Sums **live**
shifts (not publication snapshots) for the requested calendar month —
the month is evaluated in the org timezone and a shift belongs to the
month in which it **starts** (mirroring the week rule). Staff without a
wage show hours but ``cost: null`` — we never guess a wage; the current
wage applies retroactively (no wage history in MVP). Unassigned shifts
are excluded; archived staff with shifts in the period are included and
flagged.

Money math stays in Decimal end to end: SQL returns numeric hours,
per-row cost is quantized to 0.01 (ROUND_HALF_UP) and ``totals.cost``
sums the *rounded* row costs so the UI table visibly adds up.
"""

from decimal import ROUND_HALF_UP, Decimal

from flask import Blueprint, jsonify

from api_utils import ApiError, current_org, get_json_body
from db import get_db
from weeks import month_bounds_utc

bp = Blueprint('compute_labor_cost', __name__)

CENT = Decimal('0.01')


def _q(value):
    """Quantize a Decimal to 2 places, round half up, for the JSON edge."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _parse_period(body):
    if 'period' not in body:
        raise ApiError(400, 'missing_period', 'period is required')
    period = body['period']
    if not isinstance(period, str):
        raise ApiError(400, 'invalid_period', "period must be an ISO month like '2026-07'")
    return period


@bp.post('/compute/labor-cost')
def compute_labor_cost():
    with get_db() as conn:
        org = current_org(conn)
        body = get_json_body()
        unknown = set(body) - {'period'}
        if unknown:
            raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
        period = _parse_period(body)
        try:
            start, end = month_bounds_utc(period, org['timezone'])
        except ValueError:
            raise ApiError(400, 'invalid_period', "period must be an ISO month like '2026-07'")

        with conn.cursor() as cur:
            cur.execute(
                """SELECT s.id, s.name, s.hourly_wage,
                          (s.archived_at IS NOT NULL) AS archived,
                          EXTRACT(EPOCH FROM SUM(sh.ends_at - sh.starts_at)) / 3600 AS hours
                   FROM shift sh
                   JOIN staff s ON s.id = sh.staff_id
                   WHERE sh.org_id = %s AND sh.starts_at >= %s AND sh.starts_at < %s
                   GROUP BY s.id
                   ORDER BY s.name, s.id""",
                (org['id'], start, end),
            )
            rows = cur.fetchall()

    staff = []
    total_hours = Decimal(0)      # unrounded, quantized once at the edge
    total_cost = Decimal(0)       # sum of *rounded* row costs
    uncosted_hours = Decimal(0)   # unrounded hours on wage-less rows
    for row in rows:
        hours, wage = row['hours'], row['hourly_wage']
        cost = _q(hours * wage) if wage is not None else None
        total_hours += hours
        if cost is not None:
            total_cost += cost
        else:
            uncosted_hours += hours
        staff.append({
            'staff_id': str(row['id']),
            'name': row['name'],
            'archived': row['archived'],
            'hours': float(_q(hours)),
            'hourly_wage': float(wage) if wage is not None else None,
            'cost': float(cost) if cost is not None else None,
        })

    uncosted = _q(uncosted_hours)
    return jsonify({
        'period': period,
        'staff': staff,
        'totals': {
            'hours': float(_q(total_hours)),
            'cost': float(total_cost),
            'uncosted_hours': float(uncosted),
            'cost_complete': uncosted == 0,
        },
    })
