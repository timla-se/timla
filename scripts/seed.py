#!/usr/bin/env python3
"""Seed a demo organization for local development.

Creates (idempotently — a rerun wipes and recreates the demo org):

- org "Demo Bistro" (Europe/Stockholm), rules: max 40 h/week, 11 h rest
- 10 staff with share tokens, wishes and hard blocks (issue #40 fields
  exercised: provenance stamps, "Kan extra" exceptions with notes,
  desired shifts/week and an availability note)
- the current ISO week fully scheduled and published
- next week scheduled as a draft

Run:
    DATABASE_URL=postgresql://timla:timla@localhost:5433/timla python scripts/seed.py

Optionally set TIMLA_SEED_USER=<clerk-user-id> to bind a real Clerk
account to the seeded org, so a developer signed in locally can see it.
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

# (name, role, own max h/week or None, desired shifts/week or None,
#  availability note or None, hourly wage kr/h or None) — desired shifts +
# note are the issue #40 per-staff fields; the wage is issue #17. A couple
# of wages stay None on purpose to demo the uncosted state in /rapporter.
STAFF = [
    ('Lisa Andersson', 'kock', None, 4, None, 195),
    ('Erik Lindqvist', 'servis', None, None, None, 168.50),
    ('Karin Nilsson', 'servis', 30, 3, None, 172),
    ('Johan Berg', 'kock', None, None, None, 201.25),
    ('Sara Holm', 'servis', None, None, None, 165),
    ('Ali Hassan', 'kock', None, None, None, 189),
    ('Emma Sjögren', 'servis', 20, 3, 'Pluggar — helst inte vardagar före 15', None),
    ('Oskar Dahl', 'bar', None, None, None, 178.50),
    ('Maria Öberg', 'servis', None, None, None, 170),
    ('Nils Ek', 'bar', None, None, None, None),
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


def seed_user_binding(cur, org_id):
    """Bind a real Clerk user id to the seeded org, so a developer signed
    in via Clerk locally can see the demo data (issue #3). Optional — most
    seed runs (CI's smoke test included) don't set this. Idempotent: any
    prior binding for this user id is replaced (the old org row, if
    different, was just deleted above and its org_user row cascaded away)."""
    user_id = os.environ.get('TIMLA_SEED_USER')
    if not user_id:
        return
    cur.execute(
        'INSERT INTO org_user (user_id, org_id) VALUES (%s, %s) '
        'ON CONFLICT (user_id) DO UPDATE SET org_id = EXCLUDED.org_id',
        (user_id, org_id),
    )


def seed_staff(cur, org_id):
    """Returns (staff_ids, sunday_blocked_ids) so scheduling can respect the blocks."""
    staff_ids = []
    for i, (name, role, max_hours, desired_shifts, availability_note, hourly_wage) in enumerate(STAFF):
        cur.execute(
            """INSERT INTO staff (org_id, name, role, max_hours_per_week, share_token,
                                  desired_shifts_per_week, availability_note, hourly_wage)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, share_token""",
            (org_id, name, role, max_hours, secrets.token_urlsafe(24),
             desired_shifts, availability_note, hourly_wage),
        )
        staff_ids.append(cur.fetchone()['id'])

    sunday_blocked = []
    for i, staff_id in enumerate(staff_ids):
        # Wishes: even indexes prefer daytime Mon–Fri, odd prefer evenings Tue–Sat.
        # Recurring wishes represent worker answers → source='staff'.
        days, span = ((1, 2, 3, 4, 5), (9 * 60, 17 * 60)) if i % 2 == 0 else ((2, 3, 4, 5, 6), (15 * 60, 23 * 60))
        for weekday in days:
            cur.execute(
                """INSERT INTO availability_interval
                       (org_id, staff_id, kind, weekday, start_minute, end_minute, source)
                   VALUES (%s, %s, 'wish', %s, %s, %s, 'staff')""",
                (org_id, staff_id, weekday, *span),
            )
        # Every third person can never work Sundays. Standing hard blocks are
        # the manager's escape hatch (entered in StaffDetail) → source='manager'.
        if i % 3 == 0:
            cur.execute(
                """INSERT INTO availability_interval
                       (org_id, staff_id, kind, weekday, start_minute, end_minute, source)
                   VALUES (%s, %s, 'block', 7, 0, 1440, 'manager')""",
                (org_id, staff_id),
            )
            sunday_blocked.append(staff_id)

    # One dated vacation block: staff #2 is away Wednesday next week.
    next_monday = week_monday(iso_week_of(datetime.now(timezone.utc), TZ)) + timedelta(days=7)
    cur.execute(
        """INSERT INTO availability_interval
               (org_id, staff_id, kind, on_date, start_minute, end_minute, source, note)
           VALUES (%s, %s, 'block', %s, 0, 1440, 'staff', 'Semester')""",
        (org_id, staff_ids[2], next_monday + timedelta(days=2)),
    )

    # Two "Kan extra" exceptions (dated wishes, issue #40) inside the seeded
    # two-week window so the phone's date picker can reach them: one whole-day
    # entered by the worker, one time-ranged entered by the manager — exercising
    # both provenance badges ("Inlagt av chefen" on the phone, "Ifyllt av
    # personalen" in StaffDetail).
    this_monday = next_monday - timedelta(days=7)
    cur.execute(
        """INSERT INTO availability_interval
               (org_id, staff_id, kind, on_date, start_minute, end_minute, source, note)
           VALUES (%s, %s, 'wish', %s, 0, 1440, 'staff', 'Kan hoppa in om det behövs')""",
        (org_id, staff_ids[4], this_monday + timedelta(days=4)),
    )
    cur.execute(
        """INSERT INTO availability_interval
               (org_id, staff_id, kind, on_date, start_minute, end_minute, source)
           VALUES (%s, %s, 'wish', %s, %s, %s, 'manager')""",
        (org_id, staff_ids[7], next_monday + timedelta(days=3), 16 * 60, 22 * 60),
    )
    return staff_ids, sunday_blocked


def seed_week(cur, org_id, staff_ids, sunday_ok, monday):
    """Schedule one week: 3 on lunch + 1 on evening daily, Saturday close overnight.

    Sunday shifts rotate over ``sunday_ok`` only, so the demo data never
    contradicts its own hard blocks once conflict checking exists.
    """
    shifts = []
    turn = 0
    for day_offset in range(7):
        day = monday + timedelta(days=day_offset)
        assignments = [LUNCH] * 3 + [EVENING]
        if day_offset == 5:  # Saturday: an overnight closing shift into Sunday
            assignments.append(SATURDAY_CLOSE)
        pool = sunday_ok if day_offset == 6 else staff_ids
        for start_min, end_min in assignments:
            staff_id = pool[turn % len(pool)]
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
            'note': s.get('note'),
        }
        for s in shifts
    ]
    # ON CONFLICT DO UPDATE can't target an exclusion constraint, so
    # idempotency is delete-overlapping-then-insert (the same shape the
    # publish action uses).
    period_start = week_monday(week)
    period_end = period_start + timedelta(days=7)
    cur.execute(
        'DELETE FROM publication WHERE org_id = %s AND period_start < %s AND period_end > %s',
        (org_id, period_end, period_start),
    )
    cur.execute(
        'INSERT INTO publication (org_id, period_start, period_end, shifts) VALUES (%s, %s, %s, %s)',
        (org_id, period_start, period_end, json.dumps(snapshot)),
    )


def main():
    now = datetime.now(timezone.utc)
    this_week = iso_week_of(now, TZ)
    monday = week_monday(this_week)

    with get_db() as conn:
        with conn.cursor() as cur:
            org_id = seed_org(cur)
            seed_user_binding(cur, org_id)
            staff_ids, sunday_blocked = seed_staff(cur, org_id)
            sunday_ok = [s for s in staff_ids if s not in sunday_blocked]
            published_shifts = seed_week(cur, org_id, staff_ids, sunday_ok, monday)
            publish_week(cur, org_id, this_week, published_shifts)
            draft_shifts = seed_week(cur, org_id, staff_ids, sunday_ok, monday + timedelta(days=7))
            cur.execute(
                'SELECT share_token FROM staff WHERE org_id = %s LIMIT 1', (org_id,)
            )
            example_token = cur.fetchone()['share_token']
        conn.commit()

    print(f'Seeded "{ORG_NAME}" ({org_id})')
    print(f'  staff: {len(staff_ids)}')
    print(f'  {this_week}: {len(published_shifts)} shifts, published')
    print(f'  next week: {len(draft_shifts)} shifts, draft')
    print(f'  example share link: /svar/{example_token}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
