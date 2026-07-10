"""/data/publications — the publications overlapping a period (publish is
POST /action/publish).

Accepts ?period=YYYY-Www or ?from=&to= (resolve_period — publications are
date ranges since #10, so the range form is first-class). Returns the list
of publications overlapping the range ordered by period_start, each
{from, to, published_at, diverged} with `to` inclusive; empty list when
nothing overlaps.

`diverged` compares the period's live shifts against the snapshot (see
publications.py) and is a property of the publication, not of the requested
range: a two-week publication edited only in week 2 reads diverged from
week 1's view too.
"""

from flask import Blueprint, jsonify

from api_utils import current_org, resolve_period
from db import get_db
from publications import diverged, load_live_shifts, local_start_date, publication_json

bp = Blueprint('data_publications', __name__)


@bp.get('/data/publications')
def list_publications():
    with get_db() as conn:
        org = current_org(conn)
        start, end = resolve_period()
        with conn.cursor() as cur:
            cur.execute(
                """SELECT * FROM publication
                   WHERE org_id = %s AND period_start < %s AND period_end > %s
                   ORDER BY period_start""",
                (org['id'], end, start),
            )
            pubs = cur.fetchall()
        if not pubs:
            return jsonify([])

        # One live-shift query for the whole span of returned publications,
        # bucketed per publication in Python (non-overlap means every local
        # date belongs to at most one publication).
        tz = org['timezone']
        span_start = min(p['period_start'] for p in pubs)
        span_end = max(p['period_end'] for p in pubs)
        live = load_live_shifts(conn, org['id'], span_start, span_end, tz)
        dated = [(local_start_date(s['starts_at'], tz), s) for s in live]
        out = []
        for p in pubs:
            mine = [s for d, s in dated if p['period_start'] <= d < p['period_end']]
            out.append({**publication_json(p), 'diverged': diverged(p['shifts'], mine)})
    return jsonify(out)
