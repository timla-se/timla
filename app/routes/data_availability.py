"""/data/availability — the availability document per staff member.

Two layers (see issue #2): wishes (recurring only) and hard blocks
(recurring pattern + dated exceptions). PUT replaces the recurring
patterns; dated exceptions have their own sub-resource. With a period
query, GET returns the read-only expansion to concrete UTC intervals.
"""

from datetime import timedelta

from flask import Blueprint, jsonify, request

from api_utils import (ApiError, current_org, get_json_body, is_strict_int, normalize_note,
                       require_staff, resolve_period)
from db import get_db
from weeks import expand_interval

bp = Blueprint('data_availability', __name__)


def _interval_json(row):
    out = {
        'id': str(row['id']),
        'kind': row['kind'],
        'start_minute': row['start_minute'],
        'end_minute': row['end_minute'],
        'source': row['source'],  # provenance: 'staff' | 'manager' | null (unknown)
        'note': row['note'],
    }
    if row['weekday'] is not None:
        out['weekday'] = row['weekday']
    if row['on_date'] is not None:
        out['on_date'] = row['on_date'].isoformat()
    return out


def _load_intervals(conn, staff_id):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT * FROM availability_interval WHERE staff_id = %s
               ORDER BY weekday NULLS LAST, on_date, start_minute""",
            (staff_id,),
        )
        return cur.fetchall()


def _document(rows):
    # A dated wish ("Kan extra") belongs under `exceptions` only — the `wishes`
    # layer is the recurring normal week. Requiring on_date IS NULL here keeps a
    # weekday-less row out of the recurring list the frontend maps by weekday.
    return {
        'wishes': [_interval_json(r) for r in rows if r['kind'] == 'wish' and r['on_date'] is None],
        'blocks': [_interval_json(r) for r in rows if r['kind'] == 'block' and r['on_date'] is None],
        'exceptions': [_interval_json(r) for r in rows if r['on_date'] is not None],
    }


def _expansion(rows, start, end, tz):
    intervals = []
    day = start
    while day < end:
        weekday = day.isoweekday()
        for r in rows:
            recurring_hit = r['weekday'] == weekday
            dated_hit = r['on_date'] == day
            if not (recurring_hit or dated_hit):
                continue
            starts_at, ends_at = expand_interval(day, r['start_minute'], r['end_minute'], tz)
            intervals.append({
                'date': day.isoformat(),
                'kind': r['kind'],
                'starts_at': starts_at.isoformat(),
                'ends_at': ends_at.isoformat(),
                # NB: this `source` is the expansion origin (recurring vs a dated
                # exception), NOT the row's provenance column (staff/manager)
                # that `_interval_json` emits. Name overload kept for contract
                # stability; a future rename to `origin` would touch the frontend.
                'source': 'exception' if dated_hit else 'recurring',
            })
        day += timedelta(days=1)
    return intervals


def _validate_pattern(items, *, kind):
    if not isinstance(items, list):
        raise ApiError(400, 'invalid', f'{kind} must be a list')
    for item in items:
        if not isinstance(item, dict):
            raise ApiError(400, 'invalid', f'each {kind} entry must be an object')
        weekday = item.get('weekday')
        start, end = item.get('start_minute'), item.get('end_minute')
        if not (is_strict_int(weekday) and 1 <= weekday <= 7):
            raise ApiError(400, 'invalid', 'weekday must be 1-7 (ISO, 1=Monday)')
        if not (is_strict_int(start) and is_strict_int(end) and 0 <= start < end <= 1440):
            raise ApiError(400, 'invalid', 'start_minute/end_minute must satisfy 0 <= start < end <= 1440')
    return items


@bp.get('/data/availability/<uuid:staff_id>')
def get_availability(staff_id):
    with get_db() as conn:
        org = current_org(conn)
        require_staff(conn, org['id'], staff_id)
        rows = _load_intervals(conn, staff_id)
        period = resolve_period(required=False)
        if period is None:
            return jsonify(_document(rows))
        start, end = period
        return jsonify({
            'staff_id': str(staff_id),
            'from': start.isoformat(),
            'to': (end - timedelta(days=1)).isoformat(),
            'intervals': _expansion(rows, start, end, org['timezone']),
        })


@bp.put('/data/availability/<uuid:staff_id>')
def replace_availability(staff_id):
    with get_db() as conn:
        org = current_org(conn)
        require_staff(conn, org['id'], staff_id)
        body = get_json_body()
        unknown = set(body) - {'wishes', 'blocks'}
        if unknown:
            raise ApiError(400, 'unknown_field',
                           f'Unknown fields: {", ".join(sorted(unknown))} (exceptions have their own endpoint)')
        # Presence-based per kind (issue #40): an omitted key leaves that kind's
        # recurring rows untouched, an explicit [] clears them, an explicit null
        # fails validation → 400. The shipped StaffDetail always sends both keys,
        # so its behavior is unchanged.
        wishes = _validate_pattern(body['wishes'], kind='wishes') if 'wishes' in body else None
        blocks = _validate_pattern(body['blocks'], kind='blocks') if 'blocks' in body else None

        with conn.cursor() as cur:
            submitted = [(k, v) for k, v in (('wish', wishes), ('block', blocks)) if v is not None]
            if submitted:
                cur.execute(
                    """DELETE FROM availability_interval
                       WHERE staff_id = %s AND on_date IS NULL AND kind = ANY(%s)""",
                    (staff_id, [k for k, _ in submitted]),
                )
                for kind, items in submitted:
                    for item in items:
                        cur.execute(
                            """INSERT INTO availability_interval
                                   (org_id, staff_id, kind, weekday, start_minute, end_minute, source)
                               VALUES (%s, %s, %s, %s, %s, %s, 'manager')""",
                            (org['id'], staff_id, kind, item['weekday'],
                             item['start_minute'], item['end_minute']),
                        )
        conn.commit()
        rows = _load_intervals(conn, staff_id)
    return jsonify(_document(rows))


@bp.post('/data/availability/<uuid:staff_id>/exceptions')
def create_exception(staff_id):
    from datetime import date as date_cls
    with get_db() as conn:
        org = current_org(conn)
        require_staff(conn, org['id'], staff_id)
        body = get_json_body()
        unknown = set(body) - {'on_date', 'start_minute', 'end_minute', 'kind', 'note'}
        if unknown:
            raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
        try:
            on_date = date_cls.fromisoformat(body.get('on_date', ''))
        except (TypeError, ValueError):
            raise ApiError(400, 'invalid', 'on_date must be an ISO date (YYYY-MM-DD)')
        start = body.get('start_minute', 0)
        end = body.get('end_minute', 1440)
        if not (is_strict_int(start) and is_strict_int(end) and 0 <= start < end <= 1440):
            raise ApiError(400, 'invalid', 'start_minute/end_minute must satisfy 0 <= start < end <= 1440')
        # A dated exception is a hard "no" (block) or positive "Kan extra" (wish);
        # default block keeps the shipped client working.
        kind = body.get('kind', 'block')
        if kind not in ('wish', 'block'):
            raise ApiError(400, 'invalid', "kind must be 'wish' or 'block'")
        note = normalize_note(body.get('note'), 500)

        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO availability_interval
                       (org_id, staff_id, kind, on_date, start_minute, end_minute, note, source)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 'manager') RETURNING *""",
                (org['id'], staff_id, kind, on_date, start, end, note),
            )
            row = cur.fetchone()
        conn.commit()
    return jsonify(_interval_json(row)), 201


@bp.delete('/data/availability/<uuid:staff_id>/exceptions/<uuid:exception_id>')
def delete_exception(staff_id, exception_id):
    with get_db() as conn:
        org = current_org(conn)
        require_staff(conn, org['id'], staff_id)
        with conn.cursor() as cur:
            cur.execute(
                """DELETE FROM availability_interval
                   WHERE id = %s AND staff_id = %s AND on_date IS NOT NULL""",
                (exception_id, staff_id),
            )
            deleted = cur.rowcount
        conn.commit()
    if not deleted:
        raise ApiError(404, 'not_found', 'No such exception')
    return '', 204
