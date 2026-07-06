"""Shared fixtures for API tests: a throwaway org, a client bound to it,
and a staff factory. Teardown deletes the org (cascade wipes the rest)."""

import psycopg
import pytest

from app import app
from config import DATABASE_URL


@pytest.fixture
def org_id():
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO organization (name) VALUES ('API-testorg') RETURNING id")
            org_id = str(cur.fetchone()[0])
        conn.commit()
    yield org_id
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM organization WHERE id = %s', (org_id,))
        conn.commit()


@pytest.fixture
def client(org_id):
    c = app.test_client()
    c.environ_base['HTTP_X_TIMLA_ORG'] = org_id
    return c


@pytest.fixture
def make_staff(client):
    def _make(name='Lisa Andersson', **extra):
        resp = client.post('/data/staff', json={'name': name, **extra})
        assert resp.status_code == 201, resp.get_json()
        return resp.get_json()
    return _make
