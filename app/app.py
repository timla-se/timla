#!/usr/bin/env python3
"""Timla — tid, bokning och schemaläggning."""

import os

from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

import _env  # noqa: F401  side effect: load .env before the imports below read os.environ
import auth
import ratelimit
from api_utils import ApiError
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
# Same reasoning as the SECRET_KEY guard above: an unconfigured Clerk key
# would silently make every manager endpoint unreachable in prod. The test
# suite runs with TIMLA_ENV=dev (see app/conftest.py), so IS_PROD is always
# False there regardless of whether a real Clerk key is configured.
if IS_PROD and not auth.is_configured():
    raise RuntimeError('CLERK_PUBLISHABLE_KEY must be set when TIMLA_ENV is not dev')


# 'link' retired (issue #13): it's now an explicit GET route redirecting to
# /svar, and the bare page /svar/:token must fall through to the SPA, so
# 'svar' is deliberately NOT an API prefix — its JSON lives on explicit
# /svar/:token/data + /availability routes that match before the SPA catch-all.
API_PREFIXES = ('api', 'data', 'compute', 'action')


def _is_api_path(path):
    """True for JSON API paths, with or without anything after the prefix —
    exact '/api' etc. must not fall through to the SPA."""
    return path in API_PREFIXES or path.startswith(tuple(p + '/' for p in API_PREFIXES))


@app.after_request
def no_cache_api(response):
    if _is_api_path(request.path.lstrip('/')):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return response


# The unauthenticated share-link surface (issue #13). Covers /svar/:token
# (the SPA page + JSON sub-paths) and the /link -> /svar redirect. Applied via
# after_request so it also lands on ApiError 404s, the served page, and the
# redirect (whose Location carries the token).
def _is_svar_surface(path):
    return path.startswith(('/svar/', '/link/')) or path in ('/svar', '/link')


@app.after_request
def svar_surface_headers(response):
    if _is_svar_surface(request.path):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'  # keep the in-URL token out of Referer
        response.headers['X-Robots-Tag'] = 'noindex'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'  # a one-tap "Spara" page is a clickjacking target
    return response


@app.before_request
def svar_rate_limit():
    """IP-keyed throttle over ALL /svar/* (page + JSON + unknown tokens), so
    blind token-guessing can't get a fresh bucket per guess (codex #1)."""
    if not request.path.startswith('/svar/'):
        return
    if not ratelimit.check(request.remote_addr or 'unknown'):
        raise ApiError(429, 'rate_limited', 'Too many requests — slow down and try again shortly')


@app.get('/api/health')
def health():
    return jsonify({'status': 'ok', 'env': TIMLA_ENV, 'dev': IS_DEV})


# Prefixes requiring an authenticated manager (issue #3). Excludes 'api'
# (health is public) and 'link' (issue #13's unauthenticated share-link
# surface).
_MANAGER_PREFIXES = ('data', 'compute', 'action')


@app.before_request
def attach_user():
    """Verify the Clerk JWT (if present) and populate ``g.user``.

    Always runs. Token absent/invalid → ``g.user`` stays ``None``;
    per-request enforcement is require_manager_auth's job below.
    """
    g.user = None
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return
    token = auth_header[len('Bearer '):].strip()
    try:
        g.user = auth.verify_clerk_token(token)
    except auth.ClerkAuthError:
        pass  # require_manager_auth turns a missing g.user into a 401.


@app.before_request
def require_manager_auth():
    """Default-deny for /data, /compute, /action — checked by path prefix,
    so unknown paths under these prefixes 401 rather than falling through
    to a 404 (auth is enforced before routing decides a route exists)."""
    path = request.path.lstrip('/')
    if not (path in _MANAGER_PREFIXES or path.startswith(tuple(p + '/' for p in _MANAGER_PREFIXES))):
        return
    if app.config.get('TESTING') and g.user is None:
        test_user = request.headers.get('X-Test-User')
        if test_user:
            g.user = auth.ClerkUser(sub=test_user, email=None, raw_claims={})
    if g.user is None:
        raise ApiError(401, 'unauthenticated', 'Authorization: Bearer <token> required')


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
