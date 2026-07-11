"""/data/staffing-needs — the org's demand step curve (issue #11).

Recurring weekday intervals plus dated exceptions, wall-clock minutes in
the org timezone. Dated rows are a day-level OVERRIDE (not additive like
availability): any dated rows on a date replace the recurring pattern for
that date; headcount 0 is the dated full-day "closed" sentinel. With a
period query, GET returns the read-only expansion to concrete UTC
intervals.

Overlapping intervals within a weekday or date are rejected — overlap has
no meaning for a step curve (max or sum?), refusing is cheaper than
deciding. Validation is application-level; the write surface is a single
manager app, so racing writers are out of scope.
"""

from datetime import date as date_cls
from datetime import timedelta

from flask import Blueprint, jsonify

from api_utils import ApiError, current_org, get_json_body, is_strict_int, resolve_period
from db import get_db
from needs import expand_needs, load_needs

bp = Blueprint('data_staffing_needs', __name__)

MAX_HEADCOUNT = 200


def _need_json(row):
    out = {
        'id': str(row['id']),
        'start_minute': row['start_minute'],
        'end_minute': row['end_minute'],
        'headcount': row['headcount'],
    }
    if row['weekday'] is not None:
        out['weekday'] = row['weekday']
    if row['on_date'] is not None:
        out['on_date'] = row['on_date'].isoformat()
    return out


def _document(rows):
    return {
        'recurring': [_need_json(r) for r in rows if r['on_date'] is None],
        'exceptions': [_need_json(r) for r in rows if r['on_date'] is not None],
    }


def _check_no_overlap(items, label):
    """items: [(start, end)] within one weekday or one date. A step curve
    has no meaning for overlapping intervals, so any overlap is a 400."""
    ordered = sorted(items)
    for (a_start, a_end), (b_start, b_end) in zip(ordered, ordered[1:]):
        if b_start < a_end:
            raise ApiError(400, 'invalid', f'overlapping intervals on {label}')


def _validate_recurring(items):
    if not isinstance(items, list):
        raise ApiError(400, 'invalid', 'recurring must be a list')
    for item in items:
        if not isinstance(item, dict):
            raise ApiError(400, 'invalid', 'each recurring entry must be an object')
        unknown = set(item) - {'weekday', 'start_minute', 'end_minute', 'headcount'}
        if unknown:
            raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
        weekday = item.get('weekday')
        start, end = item.get('start_minute'), item.get('end_minute')
        headcount = item.get('headcount')
        if not (is_strict_int(weekday) and 1 <= weekday <= 7):
            raise ApiError(400, 'invalid', 'weekday must be 1-7 (ISO, 1=Monday)')
        if not (is_strict_int(start) and is_strict_int(end) and 0 <= start < end <= 1440):
            raise ApiError(400, 'invalid', 'start_minute/end_minute must satisfy 0 <= start < end <= 1440')
        if not (is_strict_int(headcount) and 1 <= headcount <= MAX_HEADCOUNT):
            # Recurring rows are always positive; headcount 0 exists only as a
            # dated full-day "closed" exception.
            raise ApiError(400, 'invalid', f'headcount must be 1-{MAX_HEADCOUNT} for recurring intervals')
    for weekday in {i['weekday'] for i in items}:
        _check_no_overlap(
            [(i['start_minute'], i['end_minute']) for i in items if i['weekday'] == weekday],
            f'weekday {weekday}')
    return items


@bp.get('/data/staffing-needs')
def get_staffing_needs():
    with get_db() as conn:
        org = current_org(conn)
        rows = load_needs(conn, org['id'])
        period = resolve_period(required=False)
        if period is None:
            return jsonify(_document(rows))
        start, end = period
        intervals = expand_needs(rows, start, end, org['timezone'])
        return jsonify({
            'from': start.isoformat(),
            'to': (end - timedelta(days=1)).isoformat(),
            # True iff the org has ANY needs rows at all (not just in the
            # window) — the frontend's fallback gate must distinguish "never
            # configured" from "configured but closed/empty this week".
            'configured': bool(rows),
            'intervals': [{**i,
                           'starts_at': i['starts_at'].isoformat(),
                           'ends_at': i['ends_at'].isoformat()} for i in intervals],
        })


@bp.put('/data/staffing-needs')
def replace_staffing_needs():
    with get_db() as conn:
        org = current_org(conn)
        body = get_json_body()
        unknown = set(body) - {'recurring'}
        if unknown:
            raise ApiError(400, 'unknown_field',
                           f'Unknown fields: {", ".join(sorted(unknown))} (exceptions have their own endpoint)')
        if 'recurring' not in body:
            raise ApiError(400, 'invalid', 'recurring is required ([] clears the pattern)')
        recurring = _validate_recurring(body['recurring'])

        # Atomic whole-pattern replace: single transaction, [] clears it.
        with conn.cursor() as cur:
            cur.execute(
                'DELETE FROM staffing_need WHERE org_id = %s AND on_date IS NULL',
                (org['id'],),
            )
            for item in recurring:
                cur.execute(
                    """INSERT INTO staffing_need
                           (org_id, weekday, start_minute, end_minute, headcount)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (org['id'], item['weekday'], item['start_minute'],
                     item['end_minute'], item['headcount']),
                )
        conn.commit()
        rows = load_needs(conn, org['id'])
    return jsonify(_document(rows))


@bp.post('/data/staffing-needs/exceptions')
def create_exception():
    with get_db() as conn:
        org = current_org(conn)
        body = get_json_body()
        unknown = set(body) - {'on_date', 'start_minute', 'end_minute', 'headcount'}
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
        headcount = body.get('headcount')
        if not (is_strict_int(headcount) and 0 <= headcount <= MAX_HEADCOUNT):
            raise ApiError(400, 'invalid', f'headcount must be 0-{MAX_HEADCOUNT}')
        if headcount == 0 and not (start == 0 and end == 1440):
            # Mirrors the DB CHECK: 0 is the full-day "closed" sentinel only.
            raise ApiError(400, 'invalid',
                           'headcount 0 must span the whole day (omit start_minute/end_minute)')

        with conn.cursor() as cur:
            cur.execute(
                """SELECT start_minute, end_minute FROM staffing_need
                   WHERE org_id = %s AND on_date = %s""",
                (org['id'], on_date),
            )
            existing = [(r['start_minute'], r['end_minute']) for r in cur.fetchall()]
            _check_no_overlap(existing + [(start, end)], on_date.isoformat())
            cur.execute(
                """INSERT INTO staffing_need
                       (org_id, on_date, start_minute, end_minute, headcount)
                   VALUES (%s, %s, %s, %s, %s) RETURNING *""",
                (org['id'], on_date, start, end, headcount),
            )
            row = cur.fetchone()
        conn.commit()
    return jsonify(_need_json(row)), 201


@bp.delete('/data/staffing-needs/exceptions/<uuid:exception_id>')
def delete_exception(exception_id):
    with get_db() as conn:
        org = current_org(conn)
        with conn.cursor() as cur:
            cur.execute(
                """DELETE FROM staffing_need
                   WHERE id = %s AND org_id = %s AND on_date IS NOT NULL""",
                (exception_id, org['id']),
            )
            deleted = cur.rowcount
        conn.commit()
    if not deleted:
        raise ApiError(404, 'not_found', 'No such exception')
    return '', 204
