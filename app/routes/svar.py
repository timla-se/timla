"""/svar/:token — the staff-facing, login-free share-link surface (issue #13).

The token (staff.share_token, minted by /action/staff/:id/regenerate-link) is
the whole credential: it resolves to exactly one staff row + org. This is the
only unauthenticated surface in Timla, so it stays tight — generic 404 on a
bad/rotated token (no enumeration), IP rate limiting (app.py), and every
read/write scoped to that one worker.

Routes:
- GET  /svar/<token>/data          → view context (availability + upcoming published shifts)
- PUT  /svar/<token>/availability  → recurring whole-replace + exception add/remove delta
- GET  /link/<token>               → 301 to /svar/<token> (retired name, kept working)

The bare browser page /svar/<token> is served by app.py's SPA fallback (svar
is deliberately not an API prefix); these explicit sub-path routes match first.
"""
import uuid as uuid_lib
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, redirect

from api_utils import ApiError, get_json_body, is_strict_int, normalize_note
from db import get_db
from routes.data_availability import _document, _load_intervals
from weeks import iso_week_of, week_monday

bp = Blueprint('svar', __name__)

_SCHEDULE_HORIZON_DAYS = 28


# --- token resolution ---

def _staff_by_token(conn, token, *, for_update=False):
    """Resolve a share token to (staff row incl. org name/timezone). Generic
    404 when missing or archived — never leak whether a token exists."""
    lock = ' FOR UPDATE OF s' if for_update else ''
    with conn.cursor() as cur:
        cur.execute(
            f"""SELECT s.*, o.name AS org_name, o.timezone AS org_timezone
                FROM staff s JOIN organization o ON o.id = s.org_id
                WHERE s.share_token = %s AND s.archived_at IS NULL{lock}""",
            (token,),
        )
        staff = cur.fetchone()
    if staff is None:
        raise ApiError(404, 'not_found', 'No such link')
    return staff


def _initials(name):
    parts = [p for p in (name or '').split() if p]
    return ''.join(p[0] for p in parts[:2]).upper() or '?'


# --- schedule read (horizon-agnostic; see plan step 2) ---

def _gather_schedule(conn, staff):
    """This worker's upcoming published shifts over a forward window, as a flat
    date-grouped list — no ISO-week strings in the output. Today publications
    are week-keyed, so we union every week's snapshot that overlaps the window;
    when #10 generalizes publications the contract here is unchanged."""
    tz = staff['org_timezone']
    zone = ZoneInfo(tz)
    today = datetime.now(timezone.utc).astimezone(zone).date()
    to_date = today + timedelta(days=_SCHEDULE_HORIZON_DAYS)

    # ISO weeks overlapping [today, to_date], from the Monday of today's week.
    start_monday = week_monday(iso_week_of(datetime.combine(today, datetime.min.time(), tzinfo=zone), tz))
    weeks, d = [], start_monday
    while d <= to_date:
        weeks.append(iso_week_of(datetime.combine(d, datetime.min.time(), tzinfo=zone), tz))
        d += timedelta(days=7)

    with conn.cursor() as cur:
        cur.execute(
            'SELECT shifts FROM publication WHERE org_id = %s AND week = ANY(%s)',
            (staff['org_id'], weeks),
        )
        pubs = cur.fetchall()

    staff_id = str(staff['id'])
    out = []
    for pub in pubs:
        for s in pub['shifts']:
            if s.get('staff_id') != staff_id:
                continue
            starts = datetime.fromisoformat(s['starts_at'])
            local_date = starts.astimezone(zone).date()
            if not (today <= local_date <= to_date):
                continue
            ends = datetime.fromisoformat(s['ends_at'])
            out.append({
                'date': local_date.isoformat(),
                'starts_at': s['starts_at'],
                'ends_at': s['ends_at'],
                '_hours': (ends - starts).total_seconds() / 3600.0,
            })
    out.sort(key=lambda x: x['starts_at'])
    hours = round(sum(x.pop('_hours') for x in out), 1)
    return {
        'from': today.isoformat(),
        'to': to_date.isoformat(),
        'shifts': out,
        'shift_count': len(out),
        'hours': hours,
    }


def _context(conn, staff):
    rows = _load_intervals(conn, staff['id'])
    name = staff['name'] or ''
    return {
        'staff': {
            'first_name': name.split()[0] if name.split() else name,
            'name': name,
            'desired_shifts_per_week': staff['desired_shifts_per_week'],
            'availability_note': staff['availability_note'],
        },
        'org': {
            'name': staff['org_name'],
            'initials': _initials(staff['org_name']),
            'timezone': staff['org_timezone'],
        },
        'availability': _document(rows),
        'schedule': _gather_schedule(conn, staff),
    }


# --- routes ---

@bp.get('/svar/<token>/data')
def get_data(token):
    with get_db() as conn:
        staff = _staff_by_token(conn, token)
        return jsonify(_context(conn, staff))


@bp.put('/svar/<token>/availability')
def put_availability(token):
    body = get_json_body()
    wishes, blocks, add_exceptions, remove_ids, staff_updates = _validate(body)
    with get_db() as conn:
        staff = _staff_by_token(conn, token, for_update=True)
        with conn.cursor() as cur:
            # 1. Recurring layer: per-kind whole-replace. Only the kinds the
            #    client actually submitted are touched — an omitted 'wishes'/
            #    'blocks' key leaves that kind's recurring rows intact (so a v2
            #    phone that sends only wishes never wipes manager-set recurring
            #    blocks), an explicit [] clears it. For a submitted kind the
            #    client sends the COMPLETE desired recurring state (edited
            #    weekdays as their chosen range, untouched weekdays verbatim),
            #    so rows the mobile editor can't represent (split intervals,
            #    times outside its 06:00–22:00 canvas) survive a save that
            #    didn't touch that weekday. Dated exceptions (on_date NOT NULL)
            #    are untouched here; they have their own delta below (review H1).
            submitted = [(k, v) for k, v in (('wish', wishes), ('block', blocks)) if v is not None]
            if submitted:
                cur.execute(
                    """DELETE FROM availability_interval
                       WHERE staff_id = %s AND on_date IS NULL AND kind = ANY(%s)""",
                    (staff['id'], [k for k, _ in submitted]),
                )
                for kind, items in submitted:
                    for it in items:
                        cur.execute(
                            """INSERT INTO availability_interval
                                   (org_id, staff_id, kind, weekday, start_minute, end_minute, source)
                               VALUES (%s, %s, %s, %s, %s, %s, 'staff')""",
                            (staff['org_id'], staff['id'], kind,
                             it['weekday'], it['start_minute'], it['end_minute']),
                        )
            # 2. Dated exceptions: explicit delta, never a blind delete-all
            #    (review H1). Remove only ids that belong to this staff.
            if remove_ids:
                cur.execute(
                    """DELETE FROM availability_interval
                       WHERE staff_id = %s AND on_date IS NOT NULL AND id = ANY(%s)
                       RETURNING id""",
                    (staff['id'], remove_ids),
                )
                deleted = {str(r['id']) for r in cur.fetchall()}
                if set(remove_ids) - deleted:
                    raise ApiError(400, 'invalid', 'remove_exception_ids contains ids not on this link')
            for ex in add_exceptions:
                cur.execute(
                    """INSERT INTO availability_interval
                           (org_id, staff_id, kind, on_date, start_minute, end_minute, note, source)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, 'staff')""",
                    (staff['org_id'], staff['id'], ex['kind'], ex['on_date'],
                     ex['start_minute'], ex['end_minute'], ex['note']),
                )
            # 3. Per-staff parameters: only the keys present in the body are
            #    written; an explicit null clears one back to "unspecified".
            if staff_updates:
                sets = ', '.join(f'{col} = %s' for col in staff_updates)
                cur.execute(
                    f'UPDATE staff SET {sets} WHERE id = %s',
                    (*staff_updates.values(), staff['id']),
                )
                staff = {**staff, **staff_updates}  # reflect the write in the returned context
        conn.commit()
        return jsonify(_context(conn, staff))


@bp.get('/link/<token>')
def link_redirect(token):
    """Retired name kept working: /link/:token → /svar/:token (301). The
    Location carries the token, so the redirect gets the no-store/no-referrer
    headers via app.py's after_request."""
    return redirect(f'/svar/{token}', code=301)


# --- validation (public write surface — stricter than the manager PUT) ---

def _validate(body):
    unknown = set(body) - {'wishes', 'blocks', 'add_exceptions', 'remove_exception_ids',
                           'desired_shifts_per_week', 'availability_note'}
    if unknown:
        raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
    # Presence-based per kind: an absent key is None (leave that recurring layer
    # untouched); a present key is validated (an explicit null fails the list
    # check → 400, which is correct — null is not "absent").
    wishes = _validate_recurring(body['wishes'], 'wishes') if 'wishes' in body else None
    blocks = _validate_recurring(body['blocks'], 'blocks') if 'blocks' in body else None
    add_exceptions = _validate_add_exceptions(body.get('add_exceptions', []))
    remove_ids = _validate_remove_ids(body.get('remove_exception_ids', []))
    staff_updates = _validate_staff_params(body)
    return wishes, blocks, add_exceptions, remove_ids, staff_updates


def _validate_staff_params(body):
    """Per-staff parameters editable from the phone (issue #40). Presence-based
    like the recurring keys, but here an explicit null is meaningful: it clears
    the field back to "unspecified"."""
    updates = {}
    if 'desired_shifts_per_week' in body:
        v = body['desired_shifts_per_week']
        if v is not None and not (is_strict_int(v) and 0 <= v <= 50):
            raise ApiError(400, 'invalid', 'desired_shifts_per_week must be an integer 0-50 or null')
        updates['desired_shifts_per_week'] = v
    if 'availability_note' in body:
        updates['availability_note'] = normalize_note(
            body['availability_note'], 1000, field='availability_note')
    return updates


def _validate_recurring(items, field):
    # Arbitrary weekday ranges (wall-clock minutes in the org timezone), same
    # rule as the manager availability PUT — no fixed buckets. The cap is a
    # sanity bound on a public write, not a semantic limit.
    if not isinstance(items, list) or len(items) > 21:
        raise ApiError(400, 'invalid', f'{field} must be a list of at most 21')
    for it in items:
        if not isinstance(it, dict):
            raise ApiError(400, 'invalid', f'each {field} entry must be an object')
        wd, s, e = it.get('weekday'), it.get('start_minute'), it.get('end_minute')
        if not (is_strict_int(wd) and 1 <= wd <= 7):
            raise ApiError(400, 'invalid', 'weekday must be 1-7 (ISO, 1=Monday)')
        if not (is_strict_int(s) and is_strict_int(e) and 0 <= s < e <= 1440):
            raise ApiError(400, 'invalid', 'start_minute/end_minute must satisfy 0 <= start < end <= 1440')
    return items


def _validate_add_exceptions(items):
    if not isinstance(items, list) or len(items) > 60:
        raise ApiError(400, 'invalid', 'add_exceptions must be a list of at most 60')
    lo, hi = date.today() - timedelta(days=366), date.today() + timedelta(days=731)
    out = []
    for ex in items:
        if not isinstance(ex, dict):
            raise ApiError(400, 'invalid', 'each add_exceptions entry must be an object')
        if set(ex) - {'on_date', 'start_minute', 'end_minute', 'kind', 'note'}:
            raise ApiError(400, 'invalid', 'exception has unknown fields')
        try:
            d = date.fromisoformat(ex.get('on_date', ''))
        except (TypeError, ValueError):
            raise ApiError(400, 'invalid', 'on_date must be an ISO date (YYYY-MM-DD)')
        if not (lo <= d <= hi):
            raise ApiError(400, 'invalid', 'on_date is out of the accepted range')
        s = ex.get('start_minute', 0)
        e = ex.get('end_minute', 1440)
        if not (is_strict_int(s) and is_strict_int(e) and 0 <= s < e <= 1440):
            raise ApiError(400, 'invalid', 'start_minute/end_minute must satisfy 0 <= start < end <= 1440')
        # A dated exception can now be a hard "no" (block) or positive "Kan
        # extra" (wish); default block keeps every current client working.
        kind = ex.get('kind', 'block')
        if kind not in ('wish', 'block'):
            raise ApiError(400, 'invalid', "kind must be 'wish' or 'block'")
        note = normalize_note(ex.get('note'), 500)
        out.append({'on_date': d, 'start_minute': s, 'end_minute': e, 'kind': kind, 'note': note})
    return out


def _validate_remove_ids(ids):
    if not isinstance(ids, list) or len(ids) > 200:
        raise ApiError(400, 'invalid', 'remove_exception_ids must be a list of at most 200')
    for i in ids:
        if not isinstance(i, str):
            raise ApiError(400, 'invalid', 'remove_exception_ids must be uuid strings')
        try:
            uuid_lib.UUID(i)
        except ValueError:
            raise ApiError(400, 'invalid', 'remove_exception_ids must be uuid strings')
    return ids
