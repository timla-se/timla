"""/action/publish — freeze a period's live shifts into a publication snapshot.

Body: {"period": "2026-W28"} or {"from": "...", "to": "..."} (to inclusive,
mirroring the read-side convention); both forms at once is a 400 — a write
should not guess. Publishing an empty period is legal (snapshot []): it is
how a manager retracts staff-visible shifts for a range.

Non-overlap is an invariant maintained here: overlapped older publications
are deleted, trimmed, or split so the newest publish wins for every date it
covers. Trimmed/split fragments keep their original published_at — they are
remnants of the old publish, not a new one. A per-org advisory lock
serializes concurrent publishes (FOR UPDATE alone cannot serialize two
*first* publishes over an empty range); the gist exclusion constraint stays
as the backstop and maps to 409, never 500.
"""

import json

import psycopg
from flask import Blueprint, jsonify

from api_utils import ApiError, current_org, get_json_body, parse_period
from db import get_db
from publications import filter_snapshot, load_live_shifts, publication_json, snapshot_entry

bp = Blueprint('action_publish', __name__)


def _resolve_overlap(cur, old, start, end, tz):
    """Make room for a new publication over [start, end): delete a fully
    covered row, trim a one-sided overlap, split a straddling row in two.
    Fragments keep the old row's published_at and only the snapshot entries
    whose local start date still falls inside their range."""
    fragments = []
    if old['period_start'] < start:
        fragments.append((old['period_start'], start))
    if old['period_end'] > end:
        fragments.append((end, old['period_end']))

    if not fragments:
        cur.execute('DELETE FROM publication WHERE id = %s', (old['id'],))
        return
    if len(fragments) == 1:
        (frag_start, frag_end), = fragments
        cur.execute(
            'UPDATE publication SET period_start = %s, period_end = %s, shifts = %s WHERE id = %s',
            (frag_start, frag_end,
             json.dumps(filter_snapshot(old['shifts'], frag_start, frag_end, tz)), old['id']),
        )
        return
    cur.execute('DELETE FROM publication WHERE id = %s', (old['id'],))
    for frag_start, frag_end in fragments:
        cur.execute(
            """INSERT INTO publication (org_id, period_start, period_end, published_at, shifts)
               VALUES (%s, %s, %s, %s, %s)""",
            (old['org_id'], frag_start, frag_end, old['published_at'],
             json.dumps(filter_snapshot(old['shifts'], frag_start, frag_end, tz))),
        )


@bp.post('/action/publish')
def publish():
    body = get_json_body()
    unknown = set(body) - {'period', 'from', 'to'}
    if unknown:
        raise ApiError(400, 'unknown_field', f'Unknown fields: {", ".join(sorted(unknown))}')
    period = parse_period(body, reject_both=True)
    if period is None:
        raise ApiError(400, 'missing_period', "give period (e.g. '2026-W28') or from/to")
    start, end = period

    with get_db() as conn:
        org = current_org(conn)
        tz = org['timezone']
        try:
            with conn.cursor() as cur:
                # Serialize concurrent publishes per org before touching
                # anything; held until this transaction commits/rolls back.
                cur.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))',
                            (str(org['id']),))
                snapshot = [snapshot_entry(s)
                            for s in load_live_shifts(conn, org['id'], start, end, tz)]
                cur.execute(
                    """SELECT * FROM publication
                       WHERE org_id = %s AND period_start < %s AND period_end > %s
                       ORDER BY period_start FOR UPDATE""",
                    (org['id'], end, start),
                )
                for old in cur.fetchall():
                    _resolve_overlap(cur, old, start, end, tz)
                cur.execute(
                    """INSERT INTO publication (org_id, period_start, period_end, shifts)
                       VALUES (%s, %s, %s, %s) RETURNING *""",
                    (org['id'], start, end, json.dumps(snapshot)),
                )
                row = cur.fetchone()
            conn.commit()
        except psycopg.errors.ExclusionViolation:
            raise ApiError(409, 'publish_conflict', 'Publish raced another publish — try again')
    return jsonify({**publication_json(row), 'shift_count': len(snapshot)})
