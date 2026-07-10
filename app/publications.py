"""Publication domain logic (issue #10), shared by the publish action, the
manager read (/data/publications), and the staff share link — route modules
never import each other (OpenVera pattern, like conflicts.py/weeks.py).

A publication freezes a period's live shifts into a jsonb snapshot. Periods
are local dates in the org timezone, end-exclusive in storage; the JSON API
speaks inclusive `to` and publication_json owns that ±1 day. A shift belongs
to the period where it **starts** (same rule as weeks)."""

from collections import Counter
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from weeks import local_instant


def publication_json(row):
    """Wire shape of a publication row — `to` inclusive (storage is
    end-exclusive). One serializer owns the ±1 day so it can't drift."""
    return {
        'from': row['period_start'].isoformat(),
        'to': (row['period_end'] - timedelta(days=1)).isoformat(),
        'published_at': row['published_at'].isoformat(),
    }


def snapshot_entry(shift):
    """A live shift row → its snapshot record. Open shifts (staff_id null)
    are included — the snapshot is a faithful record of the period; the
    staff link filters to own shifts so open shifts stay invisible there."""
    return {
        'id': str(shift['id']),
        'staff_id': str(shift['staff_id']) if shift['staff_id'] else None,
        'starts_at': shift['starts_at'].astimezone(timezone.utc).isoformat(),
        'ends_at': shift['ends_at'].astimezone(timezone.utc).isoformat(),
        'note': shift['note'],
    }


def load_live_shifts(conn, org_id, start, end, tz):
    """Live shifts whose start falls inside the local-date window [start, end).
    DST-safe: local_instant owns wall-clock → UTC."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT * FROM shift
               WHERE org_id = %s AND starts_at >= %s AND starts_at < %s
               ORDER BY starts_at""",
            (org_id, local_instant(start, 0, tz), local_instant(end, 0, tz)),
        )
        return cur.fetchall()


def local_start_date(starts_at, tz):
    """The local date a shift belongs to: where it starts, in the org tz."""
    return starts_at.astimezone(ZoneInfo(tz)).date()


def filter_snapshot(shifts, start, end, tz):
    """Snapshot entries whose local start date falls inside [start, end) —
    the belongs-where-it-starts rule, applied when trimming a publication."""
    return [
        s for s in shifts
        if start <= local_start_date(datetime.fromisoformat(s['starts_at']), tz) < end
    ]


def _snapshot_key(entry):
    return (
        entry.get('staff_id'),
        datetime.fromisoformat(entry['starts_at']).astimezone(timezone.utc),
        datetime.fromisoformat(entry['ends_at']).astimezone(timezone.utc),
        entry.get('note'),  # snapshots from the pre-0004 era predate the note key
    )


def _live_key(row):
    return (
        str(row['staff_id']) if row['staff_id'] else None,
        row['starts_at'].astimezone(timezone.utc),
        row['ends_at'].astimezone(timezone.utc),
        row['note'],
    )


def diverged(snapshot, live_rows):
    """Whether the period's live shifts differ from its snapshot.

    Multiset comparison of (staff_id, starts_at, ends_at, note): shift id is
    deliberately excluded so delete+recreate of an identical shift doesn't
    flag; timestamps are normalized to UTC datetimes (the snapshot stores ISO
    strings, psycopg returns aware datetimes); a missing snapshot note key
    reads as None. Note edits count — the snapshot is the record of what was
    published."""
    return Counter(map(_snapshot_key, snapshot)) != Counter(map(_live_key, live_rows))
