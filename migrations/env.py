"""Alembic runtime config.

DATABASE_URL is sourced from ``app/config.py`` so dev / prod / tests all
reach their own database without per-env alembic profiles. The bare
``postgresql://`` scheme is rewritten to ``postgresql+psycopg://`` because
the codebase ships psycopg3 (not psycopg2, which SQLAlchemy's bare
``postgresql://`` dialect defaults to).

Schema introspection / autogenerate is deliberately disabled — Timla uses
raw psycopg3 with no SQLAlchemy models, so target_metadata is None and
every migration is hand-written with ``op.execute()``.
"""

import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make app/ importable so we can pull DATABASE_URL from the same config the
# Flask app uses. This script runs from repo root via the alembic CLI.
APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app')
sys.path.insert(0, APP_DIR)
from config import DATABASE_URL  # noqa: E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None

SQLALCHEMY_URL = DATABASE_URL.replace('postgresql://', 'postgresql+psycopg://', 1)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode: emit SQL to stdout."""
    context.configure(
        url=SQLALCHEMY_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={'paramstyle': 'named'},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database connection."""
    connectable = engine_from_config(
        {'sqlalchemy.url': SQLALCHEMY_URL},
        prefix='sqlalchemy.',
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
