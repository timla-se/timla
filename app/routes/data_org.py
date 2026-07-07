"""/data/org — the calling organization (read-only; settings editing is #14)."""

from flask import Blueprint, jsonify

from api_utils import current_org
from db import get_db

bp = Blueprint('data_org', __name__)


@bp.get('/data/org')
def get_org():
    with get_db() as conn:
        org = current_org(conn)
    return jsonify({
        'id': str(org['id']),
        'name': org['name'],
        'timezone': org['timezone'],
    })
