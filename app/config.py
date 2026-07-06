"""Central configuration for Timla."""
import os

PORT = int(os.environ.get('TIMLA_PORT', 8899))

# Postgres connection. Format: postgresql://user:password@host:port/dbname
# Dev default targets the docker-compose postgres service.
DATABASE_URL = os.environ.get(
    'DATABASE_URL',
    'postgresql://timla:timla@postgres:5432/timla',
)

# Runtime environment mode.
# Defaults to production-safe behavior unless explicitly set to dev.
TIMLA_ENV = os.environ.get('TIMLA_ENV', 'prod').strip().lower()
IS_DEV = TIMLA_ENV in {'dev', 'development'}
IS_PROD = not IS_DEV
