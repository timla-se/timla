"""/action/staff — manager-scoped staff actions.

Only the token minting lives here; the public /link/:token surface that
consumes the token is issue #13's scope.
"""

import secrets

import psycopg
from flask import Blueprint, jsonify

from api_utils import ApiError, current_org, require_staff
from db import get_db
from routes.data_staff import staff_json

bp = Blueprint('action_staff', __name__)


@bp.post('/action/staff/<uuid:staff_id>/regenerate-link')
def regenerate_link(staff_id):
    """Generate (first time) or regenerate the personal share-link token.
    Regenerating invalidates the old link."""
    with get_db() as conn:
        org = current_org(conn)
        staff = require_staff(conn, org['id'], staff_id)
        if staff['archived_at'] is not None:
            raise ApiError(400, 'archived_staff', 'Archived staff cannot have active share links')
        # share_token is UNIQUE; a collision is astronomically unlikely but
        # must surface as a retry, not a 500.
        for attempt in (1, 2):
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        'UPDATE staff SET share_token = %s WHERE id = %s AND org_id = %s RETURNING *',
                        (secrets.token_urlsafe(24), staff_id, org['id']),
                    )
                    row = cur.fetchone()
                conn.commit()
                break
            except psycopg.errors.UniqueViolation:
                conn.rollback()
                if attempt == 2:
                    raise
    return jsonify(staff_json(row))
