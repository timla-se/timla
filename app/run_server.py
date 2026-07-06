#!/usr/bin/env python3
"""Local development server entry point.

Production runs gunicorn (see Dockerfile); this is for `python run_server.py`
during development.
"""

from app import app
from config import IS_DEV, PORT

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, debug=IS_DEV)
