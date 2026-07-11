"""Staffing needs: org-level demand step curve

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-11

Design notes (see issue #11):
- staffing_need mirrors availability_interval's shape (recurring weekday
  XOR dated on_date, wall-clock minutes in the org timezone) but is
  org-level: demand has no staff_id.
- Exception semantics are DAY-LEVEL OVERRIDE, not additive like
  availability: if a date has any dated rows, they replace the recurring
  pattern entirely for that date. Deleting the last dated row for a date
  restores the recurring curve — the rule reads live rows, no extra
  state. Encoded in app/needs.py.
- headcount 0 is the dated "closed that day" sentinel only, and only as
  a full-day row (a partial zero interval is meaningless — closed time
  is simply not covered by any row). Recurring rows must have positive
  headcount. Both rules are CHECKed here and validated in the route.
"""
from alembic import op

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE staffing_need (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
            weekday smallint CHECK (weekday BETWEEN 1 AND 7),
            on_date date,
            start_minute smallint NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
            end_minute smallint NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
            headcount smallint NOT NULL CHECK (headcount >= 0 AND headcount <= 200),
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT need_positive_span CHECK (end_minute > start_minute),
            CONSTRAINT need_recurring_xor_dated CHECK ((weekday IS NULL) <> (on_date IS NULL)),
            CONSTRAINT need_recurring_headcount_positive CHECK (on_date IS NOT NULL OR headcount > 0),
            CONSTRAINT need_zero_is_full_day CHECK (headcount > 0 OR (start_minute = 0 AND end_minute = 1440))
        );
        CREATE INDEX staffing_need_org_weekday_idx ON staffing_need(org_id, weekday);
        CREATE INDEX staffing_need_org_date_idx ON staffing_need(org_id, on_date);
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE staffing_need;
    """)
