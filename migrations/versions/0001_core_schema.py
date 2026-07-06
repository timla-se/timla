"""Core schema: organization, staff, shifts, availability, rules, publications

Revision ID: 0001
Revises:
Create Date: 2026-07-06

Design notes (see issue #2):
- Availability times are wall-clock minutes in the org timezone so
  recurring patterns survive DST; expansion to UTC lives in app/weeks.py.
- Wishes are recurring-only; hard blocks are recurring or dated.
- Effective max hours/week = the stricter of org_rule and staff's own cap.
- publication.shifts is a jsonb snapshot: managers keep editing live
  shifts, staff read the latest snapshot (issue #10).
"""
from alembic import op

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE organization (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name text NOT NULL,
            timezone text NOT NULL DEFAULT 'Europe/Stockholm',
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE org_rule (
            org_id uuid PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
            max_hours_per_week numeric(4,1),
            min_rest_hours numeric(4,1),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE staff (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
            name text NOT NULL,
            phone text,
            email text,
            role text,
            max_hours_per_week numeric(4,1),
            share_token text UNIQUE,
            archived_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX staff_org_idx ON staff(org_id);

        CREATE TABLE shift (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
            staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
            starts_at timestamptz NOT NULL,
            ends_at timestamptz NOT NULL,
            note text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT shift_positive_span CHECK (ends_at > starts_at)
        );
        CREATE INDEX shift_org_start_idx ON shift(org_id, starts_at);
        CREATE INDEX shift_staff_idx ON shift(staff_id);

        CREATE TABLE availability_interval (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
            staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
            kind text NOT NULL CHECK (kind IN ('wish', 'block')),
            weekday smallint CHECK (weekday BETWEEN 1 AND 7),
            on_date date,
            start_minute smallint NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
            end_minute smallint NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
            CONSTRAINT availability_positive_span CHECK (end_minute > start_minute),
            CONSTRAINT availability_recurring_xor_dated CHECK ((weekday IS NULL) <> (on_date IS NULL)),
            CONSTRAINT availability_wish_is_recurring CHECK (kind = 'block' OR on_date IS NULL)
        );
        CREATE INDEX availability_staff_idx ON availability_interval(staff_id);

        CREATE TABLE publication (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
            week text NOT NULL,
            published_at timestamptz NOT NULL DEFAULT now(),
            shifts jsonb NOT NULL,
            CONSTRAINT publication_week_format CHECK (week ~ '^\\d{4}-W\\d{2}$'),
            CONSTRAINT publication_one_per_week UNIQUE (org_id, week)
        );
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE publication;
        DROP TABLE availability_interval;
        DROP TABLE shift;
        DROP TABLE staff;
        DROP TABLE org_rule;
        DROP TABLE organization;
    """)
