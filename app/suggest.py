"""Schedule suggestion engine (issue #11) — best-effort greedy v0.

Tries to find a shift set whose staffing curve covers the org's needs
curve for one ISO week. Hard constraints (blocks, double booking,
effective max hours, min rest) are absolute; wishes are soft preferences
the ranking maximizes. The greedy may leave genuinely-coverable gaps a
human could solve by reshuffling — that is the v0 contract; gaps are
reported honestly in ``uncovered``, never papered over with open shifts.

Pure in the no-side-effects sense: reads needs, staff, availability,
rules and saved shifts, never writes. Saved *assigned* shifts already
reduce the residual need; open shifts (staff_id NULL — utannonserade
pass, see docs/api.md) cover no one.

Belt and braces: the final proposal set is validated with the full
conflict engine; any shift with a hard conflict is dropped and the
remainder revalidated iteratively (dropping one shift changes rest and
max-hours context), then ``uncovered`` is recomputed from the surviving
set. This should be a no-op; if it fires, it keeps the zero-hard-conflicts
contract honest. Wish warnings pass through.
"""

from datetime import timedelta

from conflicts import check_conflicts, _effective_max_hours
from needs import expand_needs, load_needs
from weeks import expand_interval, iso_week_of, local_instant, week_monday

MIN_SHIFT_MINUTES = 120


def suggest_schedule(conn, org, period):
    """period: a normalized ISO week ('2026-W28'). Returns
    {'shifts': [{staff_id, starts_at, ends_at}], 'uncovered': [...],
    'warnings': [...]} with datetime values (the route serializes)."""
    tz = org['timezone']
    monday = week_monday(period)
    need_intervals = [
        i for i in expand_needs(load_needs(conn, org['id']), monday, monday + timedelta(days=7), tz)
        if i['headcount'] > 0
    ]
    staff_rows, org_rules, availability, saved = _load_context(conn, org['id'], monday, tz)
    assigned_saved = [s for s in saved if s['staff_id'] is not None]

    proposals = []
    if need_intervals and staff_rows:
        days = sorted({i['date'] for i in need_intervals})
        for day_iso in days:
            _sweep_day(
                [i for i in need_intervals if i['date'] == day_iso],
                proposals, staff_rows, org_rules, availability, assigned_saved, tz, period)

    proposals.sort(key=lambda p: (p['starts_at'], p['staff_id']))
    proposals, warnings = _post_filter(conn, org, proposals)
    uncovered = _uncovered(need_intervals, assigned_saved, proposals)
    return {
        'shifts': [{'staff_id': p['staff_id'], 'starts_at': p['starts_at'], 'ends_at': p['ends_at']}
                   for p in proposals],
        'uncovered': uncovered,
        'warnings': warnings,
    }


def _load_context(conn, org_id, monday, tz):
    """Active staff, org rules, their availability, and ALL org shifts in a
    ±8-day window around the week (max-hours and rest context can hinge on
    shifts outside it — same window trick as conflicts.py)."""
    window_start = local_instant(monday, 0, tz) - timedelta(days=8)
    window_end = local_instant(monday + timedelta(days=7), 0, tz) + timedelta(days=8)
    with conn.cursor() as cur:
        cur.execute('SELECT * FROM staff WHERE org_id = %s AND archived_at IS NULL', (org_id,))
        staff_rows = {str(r['id']): r for r in cur.fetchall()}
        cur.execute('SELECT * FROM org_rule WHERE org_id = %s', (org_id,))
        org_rules = cur.fetchone()
        cur.execute('SELECT * FROM availability_interval WHERE org_id = %s', (org_id,))
        availability = cur.fetchall()
        cur.execute(
            'SELECT * FROM shift WHERE org_id = %s AND starts_at < %s AND ends_at > %s',
            (org_id, window_end, window_start),
        )
        saved = cur.fetchall()
    return staff_rows, org_rules, availability, saved


def _cover_count(intervals, t):
    return sum(1 for iv in intervals if iv['starts_at'] <= t < iv['ends_at'])


def _needed(day_needs, t):
    return sum(iv['headcount'] for iv in day_needs if iv['starts_at'] <= t < iv['ends_at'])


def _local_days(start, end, tz):
    from zoneinfo import ZoneInfo
    day = start.astimezone(ZoneInfo(tz)).date()
    last = end.astimezone(ZoneInfo(tz)).date()
    while day <= last:
        yield day
        day += timedelta(days=1)


def _expanded_rows(rows, start, end, tz):
    """Availability rows hitting the local days [start, end) spans, as UTC
    interval tuples — the conflicts.py expansion rule."""
    for day in _local_days(start, end, tz):
        for r in rows:
            if r['weekday'] == day.isoweekday() or r['on_date'] == day:
                yield expand_interval(day, r['start_minute'], r['end_minute'], tz)


def _sweep_day(day_needs, proposals, staff_rows, org_rules, availability, assigned_saved, tz, period):
    """Left-to-right greedy over one day's residual curve; mutates proposals."""
    day_start = min(iv['starts_at'] for iv in day_needs)
    day_end = max(iv['ends_at'] for iv in day_needs)
    blocks_by_staff = {}
    wishes_by_staff = {}
    for a in availability:
        target = blocks_by_staff if a['kind'] == 'block' else wishes_by_staff
        target.setdefault(str(a['staff_id']), []).append(a)

    def boundaries():
        pts = set()
        for iv in day_needs:
            pts.add(iv['starts_at'])
            pts.add(iv['ends_at'])
        for s in assigned_saved + proposals:
            for t in (s['starts_at'], s['ends_at']):
                if day_start < t < day_end:
                    pts.add(t)
        for sid in staff_rows:
            for b_start, b_end in _expanded_rows(
                    blocks_by_staff.get(sid, []) + wishes_by_staff.get(sid, []),
                    day_start, day_end, tz):
                for t in (b_start, b_end):
                    if day_start < t < day_end:
                        pts.add(t)
        return sorted(pts)

    def missing(t):
        return max(0, _needed(day_needs, t) - _cover_count(assigned_saved, t) - _cover_count(proposals, t))

    cursor = day_start
    while cursor < day_end:
        pts = boundaries()
        t = next((p for p in pts if p >= cursor and p < day_end and missing(p) > 0), None)
        if t is None:
            return
        after_t = [p for p in pts if p > t] + [day_end]
        # The contiguous missing run from t, and the contiguous positive-need
        # block containing t (the min-length clamp target).
        run_end = next((p for p in after_t if p >= day_end or missing(p) == 0), day_end)
        block_end = next((p for p in after_t if p >= day_end or _needed(day_needs, p) == 0), day_end)
        first_seg_end = after_t[0]

        candidates = [
            sid for sid in staff_rows
            if _legal(sid, t, first_seg_end, staff_rows[sid], org_rules,
                      blocks_by_staff.get(sid, []), assigned_saved, proposals, tz)
        ]
        if not candidates:
            # Only up to the next event boundary — later time in this block
            # may suit a different candidate (an availability edge, a shift
            # end freeing someone up).
            cursor = first_seg_end
            continue

        best = min(candidates, key=lambda sid: _rank(
            sid, t, run_end, staff_rows[sid], wishes_by_staff.get(sid, []),
            assigned_saved, proposals, tz, period))
        target_end = min(max(run_end, t + timedelta(minutes=MIN_SHIFT_MINUTES)), block_end)
        # Extend across contiguous need while the candidate stays legal:
        # longer is monotonically harder, so take the longest legal end.
        end_options = sorted({p for p in after_t if p <= target_end} | {target_end}, reverse=True)
        for end in end_options:
            if end > first_seg_end and not _legal(
                    best, t, end, staff_rows[best], org_rules,
                    blocks_by_staff.get(best, []), assigned_saved, proposals, tz):
                continue
            proposals.append({'staff_id': best, 'starts_at': t, 'ends_at': max(end, first_seg_end)})
            break


def _staff_timeline(sid, assigned_saved, proposals):
    return ([s for s in assigned_saved if str(s['staff_id']) == sid]
            + [p for p in proposals if p['staff_id'] == sid])


def _legal(sid, start, end, staff, org_rules, blocks, assigned_saved, proposals, tz):
    """Hard-constraint filter mirroring the conflict engine: overlap against
    saved and already-accumulated proposed shifts, availability blocks,
    effective max hours (by the week the shift starts in), and min rest."""
    timeline = _staff_timeline(sid, assigned_saved, proposals)
    for entry in timeline:
        if entry['starts_at'] < end and start < entry['ends_at']:
            return False
    for b_start, b_end in _expanded_rows(blocks, start, end, tz):
        if b_start < end and start < b_end:
            return False
    effective = _effective_max_hours(staff, org_rules)
    if effective is not None:
        week = iso_week_of(start, tz)
        hours = (end - start).total_seconds() / 3600 + sum(
            (e['ends_at'] - e['starts_at']).total_seconds() / 3600
            for e in timeline if iso_week_of(e['starts_at'], tz) == week)
        if hours > effective + 1e-9:
            return False
    min_rest = (float(org_rules['min_rest_hours'])
                if org_rules and org_rules['min_rest_hours'] is not None else None)
    if min_rest is not None:
        for entry in timeline:
            if entry['ends_at'] <= start and (start - entry['ends_at']).total_seconds() / 3600 < min_rest:
                return False
            if entry['starts_at'] >= end and (entry['starts_at'] - end).total_seconds() / 3600 < min_rest:
                return False
    return True


def _wish_fraction(wishes, start, end, tz):
    """Fraction of [start, end) covered by the staff member's expanded wishes."""
    total = (end - start).total_seconds()
    if total <= 0:
        return 0.0
    covered = 0.0
    cursor = start
    for w_start, w_end in sorted(_expanded_rows(wishes, start, end, tz)):
        w_start, w_end = max(w_start, cursor), min(w_end, end)
        if w_end > w_start:
            covered += (w_end - w_start).total_seconds()
            cursor = w_end
    return covered / total


def _rank(sid, start, end, staff, wishes, assigned_saved, proposals, tz, period):
    """Sort key — smaller is better: most wish coverage of the gap, furthest
    below desired shifts/week, fewest assigned hours in the target week, and
    staff id as the final stable tiebreak (deterministic output)."""
    timeline = _staff_timeline(sid, assigned_saved, proposals)
    week_entries = [e for e in timeline if iso_week_of(e['starts_at'], tz) == period]
    desired = staff['desired_shifts_per_week']
    deficit = (desired - len(week_entries)) if desired is not None else 0
    hours = sum((e['ends_at'] - e['starts_at']).total_seconds() / 3600 for e in week_entries)
    return (-_wish_fraction(wishes, start, end, tz), -deficit, hours, sid)


def _post_filter(conn, org, proposals):
    """Run the full conflict engine over the final set; drop hard-conflicted
    shifts and revalidate iteratively until clean."""
    warnings = []
    while proposals:
        result = check_conflicts(conn, org, [
            {'index': i, 'id': None, 'staff_id': p['staff_id'],
             'starts_at': p['starts_at'], 'ends_at': p['ends_at']}
            for i, p in enumerate(proposals)
        ])
        bad = {c['shift_index'] for c in result['conflicts']}
        if not bad:
            warnings = result['warnings']
            break
        proposals = [p for i, p in enumerate(proposals) if i not in bad]
    return proposals, warnings


def _uncovered(need_intervals, assigned_saved, proposals):
    """Residual gaps against the SURVIVING proposal set (never stale), as
    constant-missing segments: [{date, starts_at, ends_at, missing}]."""
    out = []
    for day_iso in sorted({i['date'] for i in need_intervals}):
        day_needs = [i for i in need_intervals if i['date'] == day_iso]
        day_start = min(iv['starts_at'] for iv in day_needs)
        day_end = max(iv['ends_at'] for iv in day_needs)
        pts = {day_start, day_end}
        for iv in day_needs:
            pts.update((iv['starts_at'], iv['ends_at']))
        for s in assigned_saved + proposals:
            for t in (s['starts_at'], s['ends_at']):
                if day_start < t < day_end:
                    pts.add(t)
        ordered = sorted(pts)
        for a, b in zip(ordered, ordered[1:]):
            m = max(0, _needed(day_needs, a)
                    - _cover_count(assigned_saved, a) - _cover_count(proposals, a))
            if m > 0:
                last = out[-1] if out else None
                if last and last['date'] == day_iso and last['ends_at'] == a and last['missing'] == m:
                    last['ends_at'] = b
                else:
                    out.append({'date': day_iso, 'starts_at': a, 'ends_at': b, 'missing': m})
    return out
