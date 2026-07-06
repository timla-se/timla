"""/data/shifts — CRUD for shifts. A shift belongs to the period in which
it starts (same rule as weeks); period filtering is on starts_at."""

from datetime import datetime

import psycopg
from flask import Blueprint, jsonify

from api_utils import ApiError, current_org, get_json_body, resolve_period
from db import get_db
from weeks import local_instant

bp = Blueprint('data_shifts', __name__)


def shift_json(s):
    return {
        'id': str(s['id']),
        'staff_id': str(s['staff_id']) if s['staff_id'] else None,
        'starts_at': s['starts_at'].isoformat(),
        'ends_at': s['ends_at'].isoformat(),
        'note': s['note'],
    }


def _parse_instant(value, field):
    try:
        instant = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise ApiError(400, 'invalid', f'{field} must be an ISO 8601 timestamp')
    if instant.tzinfo is None:
        raise ApiError(400, 'invalid', f'{field} must include a timezone offset (e.g. Z)')
    return instant


@bp.get('/data/shifts')
def list_shifts():
    with get_db() as conn:
        org = current_org(conn)
        start, end = resolve_period()
        tz = org['timezone']
        with conn.cursor() as cur:
            cur.execute(
                """SELECT * FROM shift
                   WHERE org_id = %s AND starts_at >= %s AND starts_at < %s
                   ORDER BY starts_at""",
                (org['id'], local_instant(start, 0, tz), local_instant(end, 0, tz)),
            )
            rows = cur.fetchall()
    return jsonify([shift_json(s) for s in rows])


@bp.post('/data/shifts')
def create_shift():
    with get_db() as conn:
        org = current_org(conn)
        body = get_json_body()
        unknown = set(body) - {'staff_id', 'starts_at', 'ends_at', 'note'}
        if unknown:
            raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
        starts_at = _parse_instant(body.get('starts_at'), 'starts_at')
        ends_at = _parse_instant(body.get('ends_at'), 'ends_at')
        if ends_at <= starts_at:
            raise ApiError(400, 'invalid', 'ends_at must be after starts_at')

        try:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO shift (org_id, staff_id, starts_at, ends_at, note)
                       VALUES (%s, %s, %s, %s, %s) RETURNING *""",
                    (org['id'], body.get('staff_id'), starts_at, ends_at, body.get('note')),
                )
                row = cur.fetchone()
            conn.commit()
        except psycopg.errors.ForeignKeyViolation:
            raise ApiError(400, 'unknown_staff', 'staff_id is not a staff member of this organization')
        except psycopg.errors.InvalidTextRepresentation:
            raise ApiError(400, 'invalid', 'staff_id must be a UUID')
    return jsonify(shift_json(row)), 201


@bp.patch('/data/shifts/<uuid:shift_id>')
def update_shift(shift_id):
    with get_db() as conn:
        org = current_org(conn)
        body = get_json_body()
        unknown = set(body) - {'staff_id', 'starts_at', 'ends_at', 'note'}
        if unknown:
            raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
        if not body:
            raise ApiError(400, 'invalid', 'No fields to update')

        with conn.cursor() as cur:
            cur.execute('SELECT * FROM shift WHERE id = %s AND org_id = %s', (shift_id, org['id']))
            existing = cur.fetchone()
        if existing is None:
            raise ApiError(404, 'not_found', 'No such shift')

        starts_at = _parse_instant(body['starts_at'], 'starts_at') if 'starts_at' in body else existing['starts_at']
        ends_at = _parse_instant(body['ends_at'], 'ends_at') if 'ends_at' in body else existing['ends_at']
        if ends_at <= starts_at:
            raise ApiError(400, 'invalid', 'ends_at must be after starts_at')
        staff_id = body.get('staff_id', str(existing['staff_id']) if existing['staff_id'] else None)
        note = body.get('note', existing['note'])

        try:
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE shift SET staff_id = %s, starts_at = %s, ends_at = %s,
                                        note = %s, updated_at = now()
                       WHERE id = %s AND org_id = %s RETURNING *""",
                    (staff_id, starts_at, ends_at, note, shift_id, org['id']),
                )
                row = cur.fetchone()
            conn.commit()
        except psycopg.errors.ForeignKeyViolation:
            raise ApiError(400, 'unknown_staff', 'staff_id is not a staff member of this organization')
        except psycopg.errors.InvalidTextRepresentation:
            raise ApiError(400, 'invalid', 'staff_id must be a UUID')
    return jsonify(shift_json(row))


@bp.delete('/data/shifts/<uuid:shift_id>')
def delete_shift(shift_id):
    with get_db() as conn:
        org = current_org(conn)
        with conn.cursor() as cur:
            cur.execute('DELETE FROM shift WHERE id = %s AND org_id = %s', (shift_id, org['id']))
            deleted = cur.rowcount
        conn.commit()
    if not deleted:
        raise ApiError(404, 'not_found', 'No such shift')
    return '', 204
