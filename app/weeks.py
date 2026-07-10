"""ISO week semantics for Timla.

Weeks are ISO 8601 (Monday start), evaluated in the organization's
timezone. An overnight shift belongs to the day and week in which it
**starts**. Recurring availability is stored as wall-clock minutes in
the org timezone and expanded to concrete UTC instants here — zoneinfo
handles DST, including the skipped/repeated hours at the transitions.
"""

import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


def iso_week_of(instant, tz):
    """The ISO week ('2026-W28') an instant belongs to, in the org timezone."""
    local = instant.astimezone(ZoneInfo(tz))
    year, week, _ = local.isocalendar()
    return f'{year}-W{week:02d}'


def week_monday(week):
    """'2026-W28' → the Monday that starts it, as a date."""
    year_s, week_s = week.split('-W')
    return date.fromisocalendar(int(year_s), int(week_s), 1)


def normalize_week(week):
    """Canonical zero-padded form of an ISO week string ('2026-W1' -> '2026-W01')."""
    monday = week_monday(week)
    year, iso_week, _ = monday.isocalendar()
    return f'{year}-W{iso_week:02d}'


def week_bounds_utc(week, tz):
    """[start, end) of an ISO week as UTC instants.

    A week is not always 168 hours: the DST-transition weeks in the org
    timezone are 167 or 169.
    """
    monday = week_monday(week)
    return (
        local_instant(monday, 0, tz),
        local_instant(monday + timedelta(days=7), 0, tz),
    )


def month_bounds_utc(month, tz):
    """[start, end) of a calendar month ('2026-07') as UTC instants.

    Like weeks, months are evaluated in the org timezone and a shift
    belongs to the month in which it **starts**. DST months are an hour
    short or long; converting the local month edges handles that.

    Raises ValueError on anything but a strict zero-padded 'YYYY-MM'.
    """
    if not isinstance(month, str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise ValueError(f'invalid month: {month!r}')
    year, mon = int(month[:4]), int(month[5:])
    first = date(year, mon, 1)
    first_of_next = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
    return local_instant(first, 0, tz), local_instant(first_of_next, 0, tz)


def local_instant(day, minute, tz):
    """Wall-clock minute-of-day on a local date → UTC instant.

    ``minute`` may be 1440, meaning end-of-day (midnight starting the next
    day). A wall time inside a DST gap is normalized by zoneinfo's fold
    rules rather than raising.
    """
    if minute == 1440:
        day, minute = day + timedelta(days=1), 0
    local = datetime.combine(day, time(minute // 60, minute % 60), tzinfo=ZoneInfo(tz))
    return local.astimezone(timezone.utc)


def expand_interval(day, start_minute, end_minute, tz):
    """A stored availability interval on a concrete date → UTC (start, end)."""
    return local_instant(day, start_minute, tz), local_instant(day, end_minute, tz)
