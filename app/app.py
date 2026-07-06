#!/usr/bin/env python3
"""Timla — tid, bokning och schemaläggning."""

import os

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

from config import IS_DEV, TIMLA_ENV

FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'frontend', 'dist',
)

app = Flask(__name__)
# A reverse proxy terminates TLS in prod and forwards plain HTTP with
# X-Forwarded-* headers; trust exactly one proxy hop.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=1)
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(32))
app.config['MAX_CONTENT_LENGTH'] = 8 * 1024 * 1024  # 8 MB


@app.after_request
def no_cache_api(response):
    if request.path.startswith(('/api/', '/link/')):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return response


@app.get('/api/health')
def health():
    return jsonify({'status': 'ok', 'env': TIMLA_ENV, 'dev': IS_DEV})


# --- SPA fallback: serve the built frontend for all non-API paths ---

@app.route('/')
@app.route('/<path:path>')
def spa(path=''):
    # Unknown API paths must 404 as JSON, never fall through to the SPA.
    if path.startswith(('api/', 'link/')):
        return jsonify({'error': 'not_found', 'message': f'No such endpoint: /{path}'}), 404
    if path and os.path.exists(os.path.join(FRONTEND_DIST, path)):
        return send_from_directory(FRONTEND_DIST, path)
    if os.path.exists(os.path.join(FRONTEND_DIST, 'index.html')):
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return jsonify({'error': 'frontend not built — run `npm run build:frontend`'}), 404
