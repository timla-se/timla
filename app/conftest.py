"""Make the flat app/ modules importable regardless of pytest's cwd."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
