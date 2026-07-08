"""Load <repo>/.env into the environment before anything reads it.

Imported for its side effect at the top of app.py, ahead of auth.py and
config.py which read os.environ at import time. override=False, so a real
environment variable (inline, docker-compose, CI) always beats the file —
the .env is only a convenience for local dev.
"""
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
