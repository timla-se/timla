#!/usr/bin/env python3
"""Seed a demo organization for local development.

Target state (issue #1): a demo org with ~10 staff, availability
(wishes + hard blocks), generated share links, one fully scheduled
draft week and one published week.

The actual data lands together with the core data model (issue #2) —
until the first migration exists there is nothing to insert. This stub
keeps `python scripts/seed.py` as the canonical entry point from day one.
"""

import sys


def main() -> int:
    print('Nothing to seed yet: the core data model arrives with issue #2.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
