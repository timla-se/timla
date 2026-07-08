"""/data/org — the calling organization (settings editing is #14).

POST is the onboarding step (#3): creates the organization and links it
to the authenticated user in one transaction. It works directly off
g.user rather than current_org, since a not-yet-onboarded user has no
org for current_org to find.
"""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Blueprint, g, jsonify

from api_utils import ApiError, current_org, get_json_body
from db import get_db

bp = Blueprint('data_org', __name__)


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
    if not isinstance(tz, str):
        raise ApiError(400, 'invalid', 'timezone must be a string')
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        # ZoneInfo raises ValueError (not ZoneInfoNotFoundError) for
        # path-like keys such as '/Europe/Stockholm' or '../UTC'.
        raise ApiError(400, 'invalid', 'timezone must be a valid IANA zone')

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
