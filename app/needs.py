"""Staffing needs expansion (issue #11).

Demand is an org-level step curve stored like availability: recurring
weekday rows plus dated rows, in wall-clock minutes in the org timezone
(DST-safe expansion via weeks.py). Unlike availability's additive
exceptions, dated needs rows are a DAY-LEVEL OVERRIDE: if a date has any
dated rows, they replace the recurring pattern entirely for that date.
Deleting the last dated row for a date restores the recurring curve —
the rule reads live rows, no extra state.

headcount 0 exists only as a dated full-day "closed that day" sentinel
(DB CHECK need_zero_is_full_day); it overrides the recurring curve to
nothing and is emitted in the expansion so clients can tell "closed by
exception" from "never configured".
"""

from datetime import timedelta

from weeks import expand_interval


def load_needs(conn, org_id):
    """All staffing_need rows for the org, recurring first, stable order."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT * FROM staffing_need WHERE org_id = %s
               ORDER BY weekday NULLS LAST, on_date, start_minute""",
            (org_id,),
        )
        return cur.fetchall()


def expand_needs(rows, start, end, tz):
    """Local dates [start, end) → the resolved demand curve as concrete UTC
    intervals: [{date, starts_at, ends_at, headcount, source}], applying the
    day-level override rule. `source` is 'exception' when the day is
    overridden by dated rows, else 'recurring'."""
    intervals = []
    day = start
    while day < end:
        dated = [r for r in rows if r['on_date'] == day]
        if dated:
            chosen, source = dated, 'exception'
        else:
            chosen, source = [r for r in rows if r['weekday'] == day.isoweekday()], 'recurring'
        for r in chosen:
            starts_at, ends_at = expand_interval(day, r['start_minute'], r['end_minute'], tz)
            intervals.append({
                'date': day.isoformat(),
                'starts_at': starts_at,
                'ends_at': ends_at,
                'headcount': r['headcount'],
                'source': source,
            })
        day += timedelta(days=1)
    return intervals
