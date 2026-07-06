"""/data/staff — the staff roster. DELETE archives (soft); nothing here
hard-deletes, so shift history always survives."""

from flask import Blueprint, jsonify, request

from api_utils import ApiError, current_org, get_json_body, require_staff
from db import get_db

bp = Blueprint('data_staff', __name__)

EDITABLE_FIELDS = ('name', 'phone', 'email', 'role', 'max_hours_per_week')


def staff_json(s):
    return {
        'id': str(s['id']),
        'name': s['name'],
        'phone': s['phone'],
        'email': s['email'],
        'role': s['role'],
        'max_hours_per_week': float(s['max_hours_per_week']) if s['max_hours_per_week'] is not None else None,
        'share_token': s['share_token'],
        'archived': s['archived_at'] is not None,
    }


def _validate(body, *, require_name):
    unknown = set(body) - set(EDITABLE_FIELDS) - {'archived'}
    if unknown:
        raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
    if require_name and not (body.get('name') or '').strip():
        raise ApiError(400, 'invalid', 'name is required')
    if 'name' in body and not (body['name'] or '').strip():
        raise ApiError(400, 'invalid', 'name must not be empty')
    max_hours = body.get('max_hours_per_week')
    if max_hours is not None and (not isinstance(max_hours, (int, float)) or not 0 < max_hours <= 168):
        raise ApiError(400, 'invalid', 'max_hours_per_week must be a number between 0 and 168')


@bp.get('/data/staff')
def list_staff():
    with get_db() as conn:
        org = current_org(conn)
        archived_filter = '' if request.args.get('include_archived') == '1' else ' AND archived_at IS NULL'
        with conn.cursor() as cur:
            cur.execute(f'SELECT * FROM staff WHERE org_id = %s{archived_filter} ORDER BY name', (org['id'],))
            rows = cur.fetchall()
    return jsonify([staff_json(s) for s in rows])


@bp.post('/data/staff')
def create_staff():
    with get_db() as conn:
        org = current_org(conn)
        body = get_json_body()
        _validate(body, require_name=True)
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO staff (org_id, name, phone, email, role, max_hours_per_week)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
                (org['id'], body['name'].strip(), body.get('phone'), body.get('email'),
                 body.get('role'), body.get('max_hours_per_week')),
            )
            row = cur.fetchone()
        conn.commit()
    return jsonify(staff_json(row)), 201


@bp.patch('/data/staff/<uuid:staff_id>')
def update_staff(staff_id):
    with get_db() as conn:
        org = current_org(conn)
        require_staff(conn, org['id'], staff_id)
        body = get_json_body()
        _validate(body, require_name=False)

        sets, values = [], []
        for field in EDITABLE_FIELDS:
            if field in body:
                sets.append(f'{field} = %s')
                values.append(body[field].strip() if field == 'name' else body[field])
        if 'archived' in body:
            sets.append('archived_at = ' + ('now()' if body['archived'] else 'NULL'))
        if not sets:
            raise ApiError(400, 'invalid', 'No fields to update')

        with conn.cursor() as cur:
            cur.execute(
                f'UPDATE staff SET {", ".join(sets)} WHERE id = %s AND org_id = %s RETURNING *',
                (*values, staff_id, org['id']),
            )
            row = cur.fetchone()
        conn.commit()
    return jsonify(staff_json(row))


@bp.delete('/data/staff/<uuid:staff_id>')
def archive_staff(staff_id):
    with get_db() as conn:
        org = current_org(conn)
        require_staff(conn, org['id'], staff_id)
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE staff SET archived_at = now() WHERE id = %s AND org_id = %s',
                (staff_id, org['id']),
            )
        conn.commit()
    return '', 204
