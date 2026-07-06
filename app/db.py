"""Database helpers for Timla."""

from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from config import DATABASE_URL


@contextmanager
def get_db():
    """Context manager for database connections.

    Yields a psycopg connection with dict-row factory. Caller is responsible
    for `conn.commit()` after mutating queries.
    """
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()
