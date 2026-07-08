from app import app


def test_health():
    client = app.test_client()
    resp = client.get('/api/health')
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['status'] == 'ok'


def test_api_responses_are_uncached():
    client = app.test_client()
    resp = client.get('/api/health')
    assert 'no-store' in resp.headers['Cache-Control']


def test_unknown_api_path_is_json_404_not_spa():
    client = app.test_client()
    for path in ('/api/nonexistent', '/api', '/link'):
        resp = client.get(path)
        assert resp.status_code == 404, path
        assert resp.get_json()['error'] == 'not_found'
        assert 'no-store' in resp.headers['Cache-Control']


def test_unauthenticated_manager_paths_401_before_routing():
    """/data, /compute, /action are auth-gated by prefix (issue #3) — an
    unauthenticated request 401s even for a path with no matching route,
    since require_manager_auth runs before Flask resolves the route."""
    client = app.test_client()
    for path in ('/data', '/data/nonexistent', '/compute/x', '/action/x'):
        resp = client.get(path)
        assert resp.status_code == 401, path
        assert resp.get_json()['error'] == 'unauthenticated'
        assert 'no-store' in resp.headers['Cache-Control']
