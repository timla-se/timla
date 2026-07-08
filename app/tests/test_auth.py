"""Auth enforcement tests for issue #3: unauthenticated access, onboarding,
and cross-org isolation. Needs a migrated database (same skip pattern as
test_schema.py); org/client fixtures live in tests/conftest.py."""

import psycopg
import pytest

from app import app
from config import DATABASE_URL
from dbfixtures import db_available

pytestmark = pytest.mark.skipif(not db_available(), reason='no database reachable at DATABASE_URL')

_MANAGER_PREFIXES = ('data', 'compute', 'action')
_DUMMY_UUID = '00000000-0000-0000-0000-000000000000'


def _manager_routes():
    """(method, url) pairs for every non-HEAD/OPTIONS method on every
    /data, /compute, /action route, with a dummy UUID substituted for any
    path parameter — without this substitution, parameterized routes never
    match and the sweep would silently pass against routing 404s instead
    of proving auth enforcement."""
    routes = []
    for rule in app.url_map.iter_rules():
        prefix = rule.rule.lstrip('/').split('/', 1)[0]
        if prefix not in _MANAGER_PREFIXES:
            continue
        values = dict.fromkeys(rule.arguments, _DUMMY_UUID)
        _, url = rule.build(values, append_unknown=False)
        for method in rule.methods - {'HEAD', 'OPTIONS'}:
            routes.append((method, url))
    return routes


def test_manager_routes_require_auth():
    client = app.test_client()
    routes = _manager_routes()
    assert routes, 'sweep found no /data, /compute, /action routes — check _manager_routes()'
    for method, url in routes:
        resp = client.open(url, method=method)
        assert resp.status_code == 401, f'{method} {url} -> {resp.status_code}'
        assert resp.get_json()['error'] == 'unauthenticated'


def test_health_is_public():
    resp = app.test_client().get('/api/health')
    assert resp.status_code == 200


def test_onboarding_creates_org_and_membership():
    app.config['TESTING'] = True
    user = 'user_test_onboarding_new'
    client = app.test_client()
    client.environ_base['HTTP_X_TEST_USER'] = user
    try:
        resp = client.post('/data/org', json={'name': 'Nykiosken'})
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()
        assert body['name'] == 'Nykiosken'
        assert body['timezone'] == 'Europe/Stockholm'

        # A second onboarding attempt for the same user is rejected.
        again = client.post('/data/org', json={'name': 'Another one'})
        assert again.status_code == 409
        assert again.get_json()['error'] == 'already_onboarded'

        # And the org is now usable — current_org resolves it.
        assert client.get('/data/org').get_json()['id'] == body['id']
    finally:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM org_user WHERE user_id = %s', (user,))
                cur.execute("DELETE FROM organization WHERE name = 'Nykiosken'")
            conn.commit()


def test_no_org_before_onboarding():
    app.config['TESTING'] = True
    client = app.test_client()
    client.environ_base['HTTP_X_TEST_USER'] = 'user_test_no_org_yet'
    resp = client.get('/data/staff')
    assert resp.status_code == 403
    assert resp.get_json()['error'] == 'no_org'


@pytest.mark.parametrize('payload', [{'name': 123}, {'name': 'X', 'timezone': 42}])
def test_onboarding_rejects_non_string_fields(payload):
    app.config['TESTING'] = True
    client = app.test_client()
    client.environ_base['HTTP_X_TEST_USER'] = 'user_test_invalid_payload'
    resp = client.post('/data/org', json=payload)
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'invalid'


def test_cross_org_isolation_via_auth(client, make_staff):
    """Belt-and-suspenders alongside test_api_data.test_org_isolation:
    two distinct authenticated users, distinct orgs, no leakage."""
    make_staff()
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO organization (name) VALUES ('Auth-isolation org') RETURNING id")
            other_org = str(cur.fetchone()[0])
            other_user = f'user_test_auth_isolation_{other_org}'
            cur.execute('INSERT INTO org_user (user_id, org_id) VALUES (%s, %s)', (other_user, other_org))
        conn.commit()
    try:
        app.config['TESTING'] = True
        other_client = app.test_client()
        other_client.environ_base['HTTP_X_TEST_USER'] = other_user
        assert other_client.get('/data/staff').get_json() == []
    finally:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM organization WHERE id = %s', (other_org,))
            conn.commit()
