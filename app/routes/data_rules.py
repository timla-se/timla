"""/data/rules — org-level scheduling rules (a singleton per org)."""

from flask import Blueprint, jsonify

from api_utils import ApiError, current_org, get_json_body
from db import get_db

bp = Blueprint('data_rules', __name__)

FIELDS = ('max_hours_per_week', 'min_rest_hours')


def _rules_json(row):
    if row is None:
        return {field: None for field in FIELDS}
    return {field: float(row[field]) if row[field] is not None else None for field in FIELDS}


@bp.get('/data/rules')
def get_rules():
    with get_db() as conn:
        org = current_org(conn)
        with conn.cursor() as cur:
            cur.execute('SELECT * FROM org_rule WHERE org_id = %s', (org['id'],))
            row = cur.fetchone()
    return jsonify(_rules_json(row))


@bp.put('/data/rules')
def put_rules():
    with get_db() as conn:
        org = current_org(conn)
        body = get_json_body()
        unknown = set(body) - set(FIELDS)
        if unknown:
            raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
        for field in FIELDS:
            value = body.get(field)
            if value is not None and (not isinstance(value, (int, float)) or not 0 < value <= 168):
                raise ApiError(400, 'invalid', f'{field} must be a number between 0 and 168, or null')

        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO org_rule (org_id, max_hours_per_week, min_rest_hours)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (org_id) DO UPDATE SET
                       max_hours_per_week = EXCLUDED.max_hours_per_week,
                       min_rest_hours = EXCLUDED.min_rest_hours,
                       updated_at = now()
                   RETURNING *""",
                (org['id'], body.get('max_hours_per_week'), body.get('min_rest_hours')),
            )
            row = cur.fetchone()
        conn.commit()
    return jsonify(_rules_json(row))
