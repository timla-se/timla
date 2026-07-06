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
    for path in ('/api/nonexistent', '/api', '/link', '/data', '/data/nonexistent', '/compute/x', '/action/x'):
        resp = client.get(path)
        assert resp.status_code == 404, path
        assert resp.get_json()['error'] == 'not_found'
        assert 'no-store' in resp.headers['Cache-Control']
