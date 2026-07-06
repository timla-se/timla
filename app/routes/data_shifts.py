"""/data/shifts — CRUD for shifts. A shift belongs to the period in which
it starts (same rule as weeks); period filtering is on starts_at."""

import uuid as uuid_lib

import psycopg
from flask import Blueprint, jsonify, request

from api_utils import ApiError, current_org, get_json_body, parse_instant, resolve_period
from conflicts import check_conflicts
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


def _staff_for_assignment(conn, org_id, value):
    """Validate a staff_id payload value: None (open shift) or the UUID of an
    active staff member in the calling org. Archived staff can't take new
    shifts. The composite FK remains as a race backstop."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ApiError(400, 'invalid', 'staff_id must be a UUID string or null')
    try:
        staff_id = uuid_lib.UUID(value)
    except ValueError:
        raise ApiError(400, 'invalid', 'staff_id must be a UUID')
    with conn.cursor() as cur:
        cur.execute('SELECT archived_at FROM staff WHERE id = %s AND org_id = %s', (staff_id, org_id))
        row = cur.fetchone()
    if row is None:
        raise ApiError(400, 'unknown_staff', 'staff_id is not a staff member of this organization')
    if row['archived_at'] is not None:
        raise ApiError(400, 'archived_staff', 'Cannot assign shifts to archived staff')
    return str(staff_id)


def _enforce_conflicts(conn, org, shift_id, staff_id, starts_at, ends_at):
    """Hard conflicts reject the write unless ?force=true; the result is
    reported in the response either way (issue #5)."""
    if staff_id:
        # Serialize check+write per staff member: without this, two
        # concurrent saves both pass the check before either commits and a
        # double booking lands without force. The advisory lock is held
        # until this connection commits or rolls back.
        with conn.cursor() as cur:
            cur.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (staff_id,))
    result = check_conflicts(conn, org, [{
        'index': 0,
        'id': str(shift_id) if shift_id else None,
        'staff_id': staff_id,
        'starts_at': starts_at,
        'ends_at': ends_at,
    }])
    if result['conflicts'] and request.args.get('force') != 'true':
        raise ApiError(409, 'conflict',
                       'Shift has hard conflicts; retry with ?force=true to override',
                       extra=result)
    return result


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
        starts_at = parse_instant(body.get('starts_at'), 'starts_at')
        ends_at = parse_instant(body.get('ends_at'), 'ends_at')
        if ends_at <= starts_at:
            raise ApiError(400, 'invalid', 'ends_at must be after starts_at')
        staff_id = _staff_for_assignment(conn, org['id'], body.get('staff_id'))
        result = _enforce_conflicts(conn, org, None, staff_id, starts_at, ends_at)

        try:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO shift (org_id, staff_id, starts_at, ends_at, note)
                       VALUES (%s, %s, %s, %s, %s) RETURNING *""",
                    (org['id'], staff_id, starts_at, ends_at, body.get('note')),
                )
                row = cur.fetchone()
            conn.commit()
        except psycopg.errors.ForeignKeyViolation:
            raise ApiError(400, 'unknown_staff', 'staff_id is not a staff member of this organization')
    return jsonify({'shift': shift_json(row), **result}), 201


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

        starts_at = parse_instant(body['starts_at'], 'starts_at') if 'starts_at' in body else existing['starts_at']
        ends_at = parse_instant(body['ends_at'], 'ends_at') if 'ends_at' in body else existing['ends_at']
        if ends_at <= starts_at:
            raise ApiError(400, 'invalid', 'ends_at must be after starts_at')
        if 'staff_id' in body:
            staff_id = _staff_for_assignment(conn, org['id'], body['staff_id'])
        else:
            staff_id = str(existing['staff_id']) if existing['staff_id'] else None
        note = body.get('note', existing['note'])
        existing_staff = str(existing['staff_id']) if existing['staff_id'] else None
        if staff_id == existing_staff and starts_at == existing['starts_at'] and ends_at == existing['ends_at']:
            # Note-only edits introduce no new conflict; re-running
            # enforcement would 409 forever on force-created shifts.
            result = {'conflicts': [], 'warnings': []}
        else:
            result = _enforce_conflicts(conn, org, shift_id, staff_id, starts_at, ends_at)

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
    return jsonify({'shift': shift_json(row), **result})


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
