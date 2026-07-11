"""/compute/suggest-schedule — greedy schedule suggestion v0 (issue #11).

Pure: reads needs, staff, availability, rules and saved shifts; never
writes. The client applies suggestions through the normal enforced
/data/shifts path, so even a stale suggestion cannot write a hard
conflict.

Input is one ISO week only — no from/to ranges in v0 (a year-long range
makes desired-shifts ranking, response size and runtime ill-defined).
"""

from flask import Blueprint, jsonify

from api_utils import ApiError, current_org, get_json_body
from db import get_db
from suggest import suggest_schedule
from weeks import normalize_week

bp = Blueprint('compute_suggest', __name__)


@bp.post('/compute/suggest-schedule')
def compute_suggest_schedule():
    with get_db() as conn:
        org = current_org(conn)
        body = get_json_body()
        unknown = set(body) - {'period'}
        if unknown:
            raise ApiError(400, 'unknown_field',
                           f'Unknown fields: {", ".join(sorted(unknown))} (one ISO week only, no from/to)')
        period = body.get('period')
        if not isinstance(period, str):
            raise ApiError(400, 'invalid_period', "period must be an ISO week like '2026-W28'")
        try:
            period = normalize_week(period)
        except ValueError:
            raise ApiError(400, 'invalid_period', "period must be an ISO week like '2026-W28'")
        result = suggest_schedule(conn, org, period)
    return jsonify({
        'period': period,
        'shifts': [{'staff_id': s['staff_id'],
                    'starts_at': s['starts_at'].isoformat(),
                    'ends_at': s['ends_at'].isoformat()} for s in result['shifts']],
        'uncovered': [{'date': u['date'],
                       'starts_at': u['starts_at'].isoformat(),
                       'ends_at': u['ends_at'].isoformat(),
                       'missing': u['missing']} for u in result['uncovered']],
        'warnings': result['warnings'],
    })
