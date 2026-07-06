"""Conflict checking engine (issue #5).

"Pure" in the no-side-effects sense: reads staff, rules, availability and
saved shifts for context, never writes. Saved shifts in the same and
adjacent weeks are always considered — max-hours and rest-time violations
depend on shifts outside the proposed set, and a rest violation can span
a week boundary. Proposed shifts replace their saved counterparts
(matched by id) during evaluation.

Hard conflicts: double_booking, blocked, max_hours, insufficient_rest.
Soft warnings: outside_wishes — only emitted for staff who have wishes
registered at all; with no wishes, all time is neutral and silence is
the honest answer.
"""

import uuid as uuid_lib
from datetime import timedelta
from zoneinfo import ZoneInfo

from weeks import expand_interval, iso_week_of


def check_conflicts(conn, org, proposed):
    """proposed: [{index, id: str|None, staff_id: str|None, starts_at, ends_at}]
    with timezone-aware datetimes. Returns {'conflicts': [...], 'warnings': [...]}."""
    staffed = [p for p in proposed if p['staff_id']]
    if not staffed:
        return {'conflicts': [], 'warnings': []}

    tz = org['timezone']
    staff_ids = sorted({p['staff_id'] for p in staffed})
    replaced_ids = {p['id'] for p in staffed if p['id']}
    window_start = min(p['starts_at'] for p in staffed) - timedelta(days=8)
    window_end = max(p['ends_at'] for p in staffed) + timedelta(days=8)

    staff_rows, org_rules, availability, saved = _load_context(
        conn, org['id'], staff_ids, window_start, window_end)

    timelines = {sid: [] for sid in staff_ids}
    for s in saved:
        if str(s['id']) in replaced_ids:
            continue
        timelines[str(s['staff_id'])].append(
            {'starts_at': s['starts_at'], 'ends_at': s['ends_at'], 'proposed': None})
    for p in staffed:
        timelines[p['staff_id']].append(
            {'starts_at': p['starts_at'], 'ends_at': p['ends_at'], 'proposed': p})

    conflicts, warnings = [], []
    for sid, timeline in timelines.items():
        timeline.sort(key=lambda e: e['starts_at'])
        staff = staff_rows[sid]
        blocks = [a for a in availability if str(a['staff_id']) == sid and a['kind'] == 'block']
        wishes = [a for a in availability if str(a['staff_id']) == sid and a['kind'] == 'wish']

        _check_double_booking(timeline, conflicts)
        _check_availability(timeline, blocks, wishes, tz, conflicts, warnings)
        _check_max_hours(timeline, staff, org_rules, tz, conflicts)
        _check_rest(timeline, org_rules, conflicts)

    return {'conflicts': conflicts, 'warnings': warnings}


def _load_context(conn, org_id, staff_ids, window_start, window_end):
    uuids = [uuid_lib.UUID(sid) for sid in staff_ids]
    with conn.cursor() as cur:
        cur.execute('SELECT * FROM staff WHERE org_id = %s AND id = ANY(%s)', (org_id, uuids))
        staff_rows = {str(r['id']): r for r in cur.fetchall()}
        cur.execute('SELECT * FROM org_rule WHERE org_id = %s', (org_id,))
        org_rules = cur.fetchone()
        cur.execute('SELECT * FROM availability_interval WHERE staff_id = ANY(%s)', (uuids,))
        availability = cur.fetchall()
        cur.execute(
            """SELECT * FROM shift
               WHERE org_id = %s AND staff_id = ANY(%s)
                 AND starts_at < %s AND ends_at > %s""",
            (org_id, uuids, window_end, window_start),
        )
        saved = cur.fetchall()
    return staff_rows, org_rules, availability, saved


def _item(type_, p, message, **details):
    return {'type': type_, 'shift_index': p['index'], 'shift_id': p['id'],
            'staff_id': p['staff_id'], 'message': message, **details}


def _check_double_booking(timeline, conflicts):
    for i, a in enumerate(timeline):
        for b in timeline[i + 1:]:
            if b['starts_at'] >= a['ends_at']:
                break
            for entry in (a, b):
                if entry['proposed'] is not None:
                    conflicts.append(_item(
                        'double_booking', entry['proposed'],
                        'Overlaps another shift for the same staff member'))


def _shift_local_days(entry, tz):
    zone = ZoneInfo(tz)
    day = entry['starts_at'].astimezone(zone).date()
    last = entry['ends_at'].astimezone(zone).date()
    while day <= last:
        yield day
        day += timedelta(days=1)


def _expanded(rows, entry, tz):
    for day in _shift_local_days(entry, tz):
        for r in rows:
            if r['weekday'] == day.isoweekday() or r['on_date'] == day:
                yield expand_interval(day, r['start_minute'], r['end_minute'], tz)


def _check_availability(timeline, blocks, wishes, tz, conflicts, warnings):
    for entry in timeline:
        p = entry['proposed']
        if p is None:
            continue
        for b_start, b_end in _expanded(blocks, entry, tz):
            if b_start < entry['ends_at'] and entry['starts_at'] < b_end:
                conflicts.append(_item(
                    'blocked', p, 'Overlaps a time the staff member cannot work'))
                break
        if wishes and not _covered(entry, _expanded(wishes, entry, tz)):
            warnings.append(_item(
                'outside_wishes', p, 'Outside the staff member’s wished working times'))


def _covered(entry, intervals):
    cursor = entry['starts_at']
    for start, end in sorted(intervals):
        if start > cursor:
            return False
        cursor = max(cursor, end)
        if cursor >= entry['ends_at']:
            return True
    return cursor >= entry['ends_at']


def _effective_max_hours(staff, org_rules):
    """The stricter of the org rule and the per-staff cap (see #2)."""
    candidates = [
        float(v) for v in (
            org_rules['max_hours_per_week'] if org_rules else None,
            staff['max_hours_per_week'],
        ) if v is not None
    ]
    return min(candidates) if candidates else None


def _check_max_hours(timeline, staff, org_rules, tz, conflicts):
    effective = _effective_max_hours(staff, org_rules)
    if effective is None:
        return
    hours = {}
    for entry in timeline:
        week = iso_week_of(entry['starts_at'], tz)
        hours[week] = hours.get(week, 0.0) + (entry['ends_at'] - entry['starts_at']).total_seconds() / 3600
    for entry in timeline:
        p = entry['proposed']
        if p is None:
            continue
        week = iso_week_of(entry['starts_at'], tz)
        if hours[week] > effective + 1e-9:
            conflicts.append(_item(
                'max_hours', p,
                f'Week {week} totals {round(hours[week], 1)} h, above the effective max of {effective:g} h',
                week=week, total_hours=round(hours[week], 1), effective_max=effective))


def _check_rest(timeline, org_rules, conflicts):
    min_rest = float(org_rules['min_rest_hours']) if org_rules and org_rules['min_rest_hours'] is not None else None
    if min_rest is None:
        return
    for a, b in zip(timeline, timeline[1:]):
        gap = (b['starts_at'] - a['ends_at']).total_seconds() / 3600
        if 0 <= gap < min_rest:  # negative gap = overlap = double_booking already
            for entry in (a, b):
                if entry['proposed'] is not None:
                    conflicts.append(_item(
                        'insufficient_rest', entry['proposed'],
                        f'Only {round(gap, 1)} h rest around an adjacent shift (minimum {min_rest:g} h)',
                        rest_hours=round(gap, 1), min_rest_hours=min_rest))
