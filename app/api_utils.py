"""Shared helpers for the JSON API: errors, org resolution, period parsing."""

import uuid as uuid_lib
from datetime import date, timedelta

from flask import jsonify, request

from weeks import week_monday


def is_number(value):
    """True for int/float but not bool (bool subclasses int)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_strict_int(value):
    """True for int but not bool."""
    return isinstance(value, int) and not isinstance(value, bool)


class ApiError(Exception):
    """Raised by route code; rendered as the canonical error shape."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def api_error_response(err):
    return jsonify({'error': err.code, 'message': err.message}), err.status


def get_json_body():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, 'invalid_json', 'Request body must be a JSON object')
    return body


def current_org(conn):
    """Resolve the calling organization.

    Interim mechanism until auth lands (#3): the org id comes from the
    X-Timla-Org header. #3 replaces this function's body with the
    authenticated principal's org — route code stays unchanged.
    """
    raw = request.headers.get('X-Timla-Org')
    if not raw:
        raise ApiError(401, 'missing_org', 'X-Timla-Org header required (interim until auth, see issue #3)')
    try:
        org_id = uuid_lib.UUID(raw)
    except ValueError:
        raise ApiError(400, 'invalid_org', 'X-Timla-Org must be a UUID')
    with conn.cursor() as cur:
        cur.execute('SELECT id, name, timezone FROM organization WHERE id = %s', (org_id,))
        org = cur.fetchone()
    if org is None:
        raise ApiError(404, 'unknown_org', 'No such organization')
    return org


def resolve_period(required=True):
    """Parse ?period=2026-W28 or ?from=YYYY-MM-DD&to=YYYY-MM-DD (to inclusive).

    Returns local dates [start, end) or None when absent and not required.
    """
    period = request.args.get('period')
    if period:
        try:
            monday = week_monday(period)
        except ValueError:
            raise ApiError(400, 'invalid_period', "period must be an ISO week like '2026-W28'")
        return monday, monday + timedelta(days=7)

    from_s, to_s = request.args.get('from'), request.args.get('to')
    if from_s or to_s:
        if not (from_s and to_s):
            raise ApiError(400, 'invalid_period', 'from and to must both be given')
        try:
            start, to = date.fromisoformat(from_s), date.fromisoformat(to_s)
        except ValueError:
            raise ApiError(400, 'invalid_period', 'from/to must be ISO dates (YYYY-MM-DD)')
        if to < start:
            raise ApiError(400, 'invalid_period', 'to must not be before from')
        if (to - start).days >= 366:
            raise ApiError(400, 'invalid_period', 'range must be at most one year')
        return start, to + timedelta(days=1)

    if required:
        raise ApiError(400, 'missing_period', "give ?period=2026-W28 or ?from=...&to=...")
    return None


def require_staff(conn, org_id, staff_id):
    """The staff row, or a 404 ApiError if it isn't in the calling org."""
    with conn.cursor() as cur:
        cur.execute('SELECT * FROM staff WHERE id = %s AND org_id = %s', (staff_id, org_id))
        staff = cur.fetchone()
    if staff is None:
        raise ApiError(404, 'unknown_staff', 'No such staff member in this organization')
    return staff
