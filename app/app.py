#!/usr/bin/env python3
"""Timla — tid, bokning och schemaläggning."""

import os

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

from config import IS_DEV, IS_PROD, TIMLA_ENV

FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'frontend', 'dist',
)

app = Flask(__name__)
# A reverse proxy terminates TLS in prod and forwards plain HTTP with
# X-Forwarded-* headers; trust exactly one proxy hop.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=1)
# A random fallback secret would silently break in prod: gunicorn workers
# each get their own key, so sessions signed by one worker are invalid on
# the next. Fail loudly instead; the throwaway key is dev-only.
_secret_key = os.environ.get('SECRET_KEY')
if not _secret_key:
    if IS_PROD:
        raise RuntimeError('SECRET_KEY must be set when TIMLA_ENV is not dev')
    _secret_key = os.urandom(32)
app.secret_key = _secret_key
app.config['MAX_CONTENT_LENGTH'] = 8 * 1024 * 1024  # 8 MB


API_PREFIXES = ('api', 'link', 'data', 'compute', 'action')


def _is_api_path(path):
    """True for JSON API paths, with or without anything after the prefix —
    exact '/api' etc. must not fall through to the SPA."""
    return path in API_PREFIXES or path.startswith(tuple(p + '/' for p in API_PREFIXES))


@app.after_request
def no_cache_api(response):
    if _is_api_path(request.path.lstrip('/')):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return response


@app.get('/api/health')
def health():
    return jsonify({'status': 'ok', 'env': TIMLA_ENV, 'dev': IS_DEV})


import routes  # noqa: E402  (flat-module layout; needs app defined above)

routes.register(app)


# --- SPA fallback: serve the built frontend for all non-API paths ---

@app.route('/')
@app.route('/<path:path>')
def spa(path=''):
    # Unknown API paths must 404 as JSON, never fall through to the SPA.
    if _is_api_path(path):
        return jsonify({'error': 'not_found', 'message': f'No such endpoint: /{path}'}), 404
    # isfile, not exists: a directory name (e.g. /assets) must fall through
    # to the SPA rather than 404 inside send_from_directory.
    if path and os.path.isfile(os.path.join(FRONTEND_DIST, path)):
        return send_from_directory(FRONTEND_DIST, path)
    if os.path.exists(os.path.join(FRONTEND_DIST, 'index.html')):
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return jsonify({'error': 'frontend not built — run `npm run build:frontend`'}), 404
