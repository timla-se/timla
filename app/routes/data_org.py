"""/data/org — the calling organization.

POST is the onboarding step (#3): creates the organization and links it
to the authenticated user in one transaction. It works directly off
g.user rather than current_org, since a not-yet-onboarded user has no
org for current_org to find.

PATCH is the settings edit (#14): partial update of name/timezone.
"""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Blueprint, g, jsonify

from api_utils import ApiError, current_org, get_json_body
from db import get_db

bp = Blueprint('data_org', __name__)


def _validate_timezone(tz):
    if not isinstance(tz, str):
        raise ApiError(400, 'invalid', 'timezone must be a string')
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        # ZoneInfo raises ValueError (not ZoneInfoNotFoundError) for
        # path-like keys such as '/Europe/Stockholm' or '../UTC'.
        raise ApiError(400, 'invalid', 'timezone must be a valid IANA zone')


@bp.get('/data/org')
def get_org():
    with get_db() as conn:
        org = current_org(conn)
    return jsonify({
        'id': str(org['id']),
        'name': org['name'],
        'timezone': org['timezone'],
    })


@bp.post('/data/org')
def create_org():
    body = get_json_body()
    name = body.get('name')
    if not isinstance(name, str) or not name.strip():
        raise ApiError(400, 'invalid', 'name is required')
    name = name.strip()
    tz = body.get('timezone', 'Europe/Stockholm')
    _validate_timezone(tz)

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO organization (name, timezone) VALUES (%s, %s) RETURNING id, name, timezone',
                (name, tz),
            )
            org = cur.fetchone()
            # ON CONFLICT DO NOTHING makes the "already onboarded" check
            # atomic — a check-then-insert has a race window where two
            # concurrent onboarding requests for the same user could both
            # pass the check and one would hit a raw unique-violation 500.
            cur.execute(
                'INSERT INTO org_user (user_id, org_id, email) VALUES (%s, %s, %s) '
                'ON CONFLICT (user_id) DO NOTHING',
                (g.user.sub, org['id'], g.user.email),
            )
            if cur.rowcount == 0:
                conn.rollback()  # discard the orphaned organization row above
                raise ApiError(409, 'already_onboarded', 'This account already belongs to an organization')
        conn.commit()
    return jsonify({'id': str(org['id']), 'name': org['name'], 'timezone': org['timezone']}), 201


@bp.patch('/data/org')
def update_org():
    body = get_json_body()
    unknown = set(body) - {'name', 'timezone'}
    if unknown:
        raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')

    sets, values = [], []
    if 'name' in body:
        name = body['name']
        if not isinstance(name, str) or not name.strip():
            raise ApiError(400, 'invalid', 'name must be a non-empty string')
        sets.append('name = %s')
        values.append(name.strip())
    if 'timezone' in body:
        _validate_timezone(body['timezone'])
        sets.append('timezone = %s')
        values.append(body['timezone'])
    if not sets:
        raise ApiError(400, 'invalid', 'No fields to update')

    with get_db() as conn:
        org = current_org(conn)
        with conn.cursor() as cur:
            cur.execute(
                f'UPDATE organization SET {", ".join(sets)} WHERE id = %s RETURNING id, name, timezone',
                (*values, org['id']),
            )
            row = cur.fetchone()
        conn.commit()
    return jsonify({'id': str(row['id']), 'name': row['name'], 'timezone': row['timezone']})
