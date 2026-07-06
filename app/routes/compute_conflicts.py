"""/compute/conflicts — validate a set of proposed shifts (issue #5).

Pure: any number of calls never changes state. The shift editor calls
this live while editing; /data/shifts writes run the same engine as
enforcement.
"""

import uuid as uuid_lib

from flask import Blueprint, jsonify

from api_utils import ApiError, current_org, get_json_body, parse_instant
from conflicts import check_conflicts
from db import get_db

bp = Blueprint('compute_conflicts', __name__)

MAX_SHIFTS = 500
SHIFT_FIELDS = {'id', 'staff_id', 'starts_at', 'ends_at', 'note'}


def _parse_uuid(value, field):
    if not isinstance(value, str):
        raise ApiError(400, 'invalid', f'{field} must be a UUID string')
    try:
        return str(uuid_lib.UUID(value))
    except ValueError:
        raise ApiError(400, 'invalid', f'{field} must be a UUID')


def _parse_proposed(index, item):
    if not isinstance(item, dict):
        raise ApiError(400, 'invalid', f'shifts[{index}] must be an object')
    unknown = set(item) - SHIFT_FIELDS
    if unknown:
        raise ApiError(400, 'unknown_field',
                       f'shifts[{index}]: unknown fields: {", ".join(sorted(unknown))}')
    starts_at = parse_instant(item.get('starts_at'), f'shifts[{index}].starts_at')
    ends_at = parse_instant(item.get('ends_at'), f'shifts[{index}].ends_at')
    if ends_at <= starts_at:
        raise ApiError(400, 'invalid', f'shifts[{index}]: ends_at must be after starts_at')
    staff_id = item.get('staff_id')
    if staff_id is not None:
        staff_id = _parse_uuid(staff_id, f'shifts[{index}].staff_id')
    shift_id = item.get('id')
    if shift_id is not None:
        shift_id = _parse_uuid(shift_id, f'shifts[{index}].id')
    return {'index': index, 'id': shift_id, 'staff_id': staff_id,
            'starts_at': starts_at, 'ends_at': ends_at}


def _require_staff_in_org(conn, org_id, proposed):
    wanted = {p['staff_id'] for p in proposed if p['staff_id']}
    if not wanted:
        return
    with conn.cursor() as cur:
        cur.execute('SELECT id FROM staff WHERE org_id = %s AND id = ANY(%s)',
                    (org_id, [uuid_lib.UUID(s) for s in wanted]))
        found = {str(r['id']) for r in cur.fetchall()}
    missing = wanted - found
    if missing:
        raise ApiError(400, 'unknown_staff',
                       f'Not staff of this organization: {", ".join(sorted(missing))}')


@bp.post('/compute/conflicts')
def compute_conflicts():
    with get_db() as conn:
        org = current_org(conn)
        body = get_json_body()
        unknown = set(body) - {'shifts'}
        if unknown:
            raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
        shifts = body.get('shifts')
        if not isinstance(shifts, list) or not shifts:
            raise ApiError(400, 'invalid', 'shifts must be a non-empty list')
        if len(shifts) > MAX_SHIFTS:
            raise ApiError(400, 'invalid', f'at most {MAX_SHIFTS} shifts per call')
        proposed = [_parse_proposed(i, item) for i, item in enumerate(shifts)]
        _require_staff_in_org(conn, org['id'], proposed)
        result = check_conflicts(conn, org, proposed)
    return jsonify(result)
