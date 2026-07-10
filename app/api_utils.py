"""Shared helpers for the JSON API: errors, org resolution, period parsing."""

from datetime import date, datetime, timedelta

from flask import g, jsonify, request

from weeks import week_monday


def is_number(value):
    """True for int/float but not bool (bool subclasses int)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_strict_int(value):
    """True for int but not bool."""
    return isinstance(value, int) and not isinstance(value, bool)


def normalize_note(value, cap, *, field='note'):
    """A free-text field: None or a string, trimmed, empty/whitespace → None,
    length-capped. Returns the value to store; raises ApiError(400) on a bad
    type or over-length. Used for availability exception notes and the
    per-staff availability note, both reachable from the public /svar surface."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ApiError(400, 'invalid', f'{field} must be a string or null')
    trimmed = value.strip()
    if len(trimmed) > cap:
        raise ApiError(400, 'invalid', f'{field} must be at most {cap} characters')
    return trimmed or None


class ApiError(Exception):
    """Raised by route code; rendered as the canonical error shape.
    ``extra`` keys are merged into the response body (e.g. conflict lists)."""

    def __init__(self, status, code, message, extra=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}

def api_error_response(err):
    return jsonify({'error': err.code, 'message': err.message, **err.extra}), err.status


def parse_instant(value, field):
    """Parse a required ISO 8601 timestamp; must be timezone-aware."""
    try:
        instant = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise ApiError(400, 'invalid', f'{field} must be an ISO 8601 timestamp')
    if instant.tzinfo is None:
        raise ApiError(400, 'invalid', f'{field} must include a timezone offset (e.g. Z)')
    return instant


def get_json_body():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, 'invalid_json', 'Request body must be a JSON object')
    return body


def current_org(conn):
    """Resolve the calling organization from the authenticated user.

    require_manager_auth (app.py) guarantees g.user is set before any
    route touching this can run.
    """
    with conn.cursor() as cur:
        cur.execute(
            'SELECT o.id, o.name, o.timezone FROM org_user ou '
            'JOIN organization o ON o.id = ou.org_id WHERE ou.user_id = %s',
            (g.user.sub,),
        )
        org = cur.fetchone()
    if org is None:
        raise ApiError(403, 'no_org', 'No organization linked to this account yet — onboard via POST /data/org')
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
