#!/usr/bin/env python3
"""Seed a demo organization for local development.

Creates (idempotently — a rerun wipes and recreates the demo org):

- org "Demo Bistro" (Europe/Stockholm), rules: max 40 h/week, 11 h rest
- 10 staff with share tokens, wishes and hard blocks
- the current ISO week fully scheduled and published
- next week scheduled as a draft

Run:
    DATABASE_URL=postgresql://timla:timla@localhost:5433/timla python scripts/seed.py
"""

import json
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))
from db import get_db  # noqa: E402
from weeks import iso_week_of, local_instant, week_monday  # noqa: E402

TZ = 'Europe/Stockholm'
ORG_NAME = 'Demo Bistro'

# (name, role, own max h/week or None)
STAFF = [
    ('Lisa Andersson', 'kock', None),
    ('Erik Lindqvist', 'servis', None),
    ('Karin Nilsson', 'servis', 30),
    ('Johan Berg', 'kock', None),
    ('Sara Holm', 'servis', None),
    ('Ali Hassan', 'kock', None),
    ('Emma Sjögren', 'servis', 20),
    ('Oskar Dahl', 'bar', None),
    ('Maria Öberg', 'servis', None),
    ('Nils Ek', 'bar', None),
]

LUNCH = (11 * 60, 14 * 60)      # 3 people every day
EVENING = (17 * 60, 21 * 60)    # 1 person every day
SATURDAY_CLOSE = (18 * 60, 26 * 60)  # overnight: Sat 18:00 → Sun 02:00


def seed_org(cur):
    cur.execute('DELETE FROM organization WHERE name = %s', (ORG_NAME,))
    cur.execute(
        'INSERT INTO organization (name, timezone) VALUES (%s, %s) RETURNING id',
        (ORG_NAME, TZ),
    )
    org_id = cur.fetchone()['id']
    cur.execute(
        'INSERT INTO org_rule (org_id, max_hours_per_week, min_rest_hours) VALUES (%s, 40, 11)',
        (org_id,),
    )
    return org_id


def seed_staff(cur, org_id):
    staff_ids = []
    for i, (name, role, max_hours) in enumerate(STAFF):
        cur.execute(
            """INSERT INTO staff (org_id, name, role, max_hours_per_week, share_token)
               VALUES (%s, %s, %s, %s, %s) RETURNING id, share_token""",
            (org_id, name, role, max_hours, secrets.token_urlsafe(24)),
        )
        staff_ids.append(cur.fetchone()['id'])

    for i, staff_id in enumerate(staff_ids):
        # Wishes: even indexes prefer daytime Mon–Fri, odd prefer evenings Tue–Sat.
        days, span = ((1, 2, 3, 4, 5), (9 * 60, 17 * 60)) if i % 2 == 0 else ((2, 3, 4, 5, 6), (15 * 60, 23 * 60))
        for weekday in days:
            cur.execute(
                """INSERT INTO availability_interval
                       (org_id, staff_id, kind, weekday, start_minute, end_minute)
                   VALUES (%s, %s, 'wish', %s, %s, %s)""",
                (org_id, staff_id, weekday, *span),
            )
        # Every third person can never work Sundays.
        if i % 3 == 0:
            cur.execute(
                """INSERT INTO availability_interval
                       (org_id, staff_id, kind, weekday, start_minute, end_minute)
                   VALUES (%s, %s, 'block', 7, 0, 1440)""",
                (org_id, staff_id),
            )

    # One dated vacation block: staff #2 is away Wednesday next week.
    next_monday = week_monday(iso_week_of(datetime.now(timezone.utc), TZ)) + timedelta(days=7)
    cur.execute(
        """INSERT INTO availability_interval
               (org_id, staff_id, kind, on_date, start_minute, end_minute)
           VALUES (%s, %s, 'block', %s, 0, 1440)""",
        (org_id, staff_ids[2], next_monday + timedelta(days=2)),
    )
    return staff_ids


def seed_week(cur, org_id, staff_ids, monday):
    """Schedule one week: 3 on lunch + 1 on evening daily, Saturday close overnight."""
    shifts = []
    turn = 0
    for day_offset in range(7):
        day = monday + timedelta(days=day_offset)
        assignments = [LUNCH] * 3 + [EVENING]
        if day_offset == 5:  # Saturday: an overnight closing shift into Sunday
            assignments.append(SATURDAY_CLOSE)
        for start_min, end_min in assignments:
            staff_id = staff_ids[turn % len(staff_ids)]
            turn += 1
            end_day, end_minute = (day + timedelta(days=1), end_min - 1440) if end_min > 1440 else (day, end_min)
            cur.execute(
                """INSERT INTO shift (org_id, staff_id, starts_at, ends_at)
                   VALUES (%s, %s, %s, %s) RETURNING id, staff_id, starts_at, ends_at""",
                (org_id, staff_id, local_instant(day, start_min, TZ), local_instant(end_day, end_minute, TZ)),
            )
            shifts.append(cur.fetchone())
    return shifts


def publish_week(cur, org_id, week, shifts):
    snapshot = [
        {
            'id': str(s['id']),
            'staff_id': str(s['staff_id']),
            'starts_at': s['starts_at'].isoformat(),
            'ends_at': s['ends_at'].isoformat(),
        }
        for s in shifts
    ]
    cur.execute(
        """INSERT INTO publication (org_id, week, shifts) VALUES (%s, %s, %s)
           ON CONFLICT (org_id, week)
           DO UPDATE SET shifts = EXCLUDED.shifts, published_at = now()""",
        (org_id, week, json.dumps(snapshot)),
    )


def main():
    now = datetime.now(timezone.utc)
    this_week = iso_week_of(now, TZ)
    monday = week_monday(this_week)

    with get_db() as conn:
        with conn.cursor() as cur:
            org_id = seed_org(cur)
            staff_ids = seed_staff(cur, org_id)
            published_shifts = seed_week(cur, org_id, staff_ids, monday)
            publish_week(cur, org_id, this_week, published_shifts)
            draft_shifts = seed_week(cur, org_id, staff_ids, monday + timedelta(days=7))
            cur.execute(
                'SELECT share_token FROM staff WHERE org_id = %s LIMIT 1', (org_id,)
            )
            example_token = cur.fetchone()['share_token']
        conn.commit()

    print(f'Seeded "{ORG_NAME}" ({org_id})')
    print(f'  staff: {len(staff_ids)}')
    print(f'  {this_week}: {len(published_shifts)} shifts, published')
    print(f'  next week: {len(draft_shifts)} shifts, draft')
    print(f'  example share link: /link/{example_token}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
