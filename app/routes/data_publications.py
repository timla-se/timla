"""/data/publications — read a week's publish state (publishing is #10).

Takes an explicit required ?period=YYYY-Www: the publication table is
keyed by the week string, so the from/to range form that resolve_period()
also accepts has no meaning here.
"""

from flask import Blueprint, jsonify, request

from api_utils import ApiError, current_org
from db import get_db
from weeks import normalize_week

bp = Blueprint('data_publications', __name__)


@bp.get('/data/publications')
def get_publication():
    period = request.args.get('period')
    if not period:
        raise ApiError(400, 'missing_period', "period is required, an ISO week like '2026-W28'")
    try:
        period = normalize_week(period)
    except (ValueError, AttributeError):
        raise ApiError(400, 'invalid_period', "period must be an ISO week like '2026-W28'")

    with get_db() as conn:
        org = current_org(conn)
        with conn.cursor() as cur:
            cur.execute(
                'SELECT week, published_at FROM publication WHERE org_id = %s AND week = %s',
                (org['id'], period),
            )
            row = cur.fetchone()
    if row is None:
        return jsonify(None)
    return jsonify({'week': row['week'], 'published_at': row['published_at'].isoformat()})
