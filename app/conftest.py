"""Test bootstrap: make flat app/ modules importable regardless of pytest's
cwd, and default to dev mode so importing app.py doesn't require SECRET_KEY."""
import os
import sys

os.environ.setdefault('TIMLA_ENV', 'dev')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
