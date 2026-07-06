"""Shared DB-availability probe for test modules' skipif marks."""
import psycopg

from config import DATABASE_URL


def db_available():
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=2):
            return True
    except psycopg.OperationalError:
        return False
