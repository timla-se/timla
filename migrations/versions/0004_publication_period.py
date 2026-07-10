"""Publication periods: week key → arbitrary [period_start, period_end) date range

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-10

Design notes (see issue #10):
- The publication period generalizes from one ISO week to an arbitrary
  date range. period_start/period_end are local dates in the org timezone,
  end-EXCLUSIVE in storage (the JSON API keeps its inclusive `to`).
- Backfill: to_date(week, 'IYYY-"W"IW') parses the ISO week string to its
  Monday; period_end is +7 days.
- Non-overlap per org is an invariant: the publish action trims/splits
  older publications, and the gist exclusion constraint is the backstop.
  daterange's default [) bounds match the end-exclusive storage, so
  adjacent periods do not conflict. Requires the btree_gist extension
  (CREATE EXTENSION needs database-level privileges — fine on the dev
  docker image; deployment story is #12's).
- The ≤366-day CHECK mirrors resolve_period's one-year sanity cap.

Downgrade is destructive on purpose (dev-only escape hatch): publications
that are not Monday-aligned 7-day periods have no week-key representation
(two sub-week fragments could even collide on the same week), so they are
DELETEd before the week column and its constraints are restored.
"""
from alembic import op

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE EXTENSION IF NOT EXISTS btree_gist;

        ALTER TABLE publication
            ADD COLUMN period_start date,
            ADD COLUMN period_end date;

        UPDATE publication SET
            period_start = to_date(week, 'IYYY-"W"IW'),
            period_end = to_date(week, 'IYYY-"W"IW') + 7;

        ALTER TABLE publication
            ALTER COLUMN period_start SET NOT NULL,
            ALTER COLUMN period_end SET NOT NULL,
            DROP CONSTRAINT publication_week_format,
            DROP CONSTRAINT publication_one_per_week,
            DROP COLUMN week,
            ADD CONSTRAINT publication_positive_span
                CHECK (period_end > period_start),
            ADD CONSTRAINT publication_max_span
                CHECK (period_end - period_start <= 366),
            ADD CONSTRAINT publication_no_overlap
                EXCLUDE USING gist (org_id WITH =, daterange(period_start, period_end) WITH &&);

        CREATE INDEX publication_org_start_idx ON publication(org_id, period_start);
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM publication
        WHERE period_end - period_start <> 7
           OR extract(isodow FROM period_start) <> 1;

        ALTER TABLE publication ADD COLUMN week text;
        UPDATE publication SET week = to_char(period_start, 'IYYY-"W"IW');

        DROP INDEX publication_org_start_idx;
        ALTER TABLE publication
            ALTER COLUMN week SET NOT NULL,
            DROP CONSTRAINT publication_no_overlap,
            DROP CONSTRAINT publication_max_span,
            DROP CONSTRAINT publication_positive_span,
            DROP COLUMN period_start,
            DROP COLUMN period_end,
            ADD CONSTRAINT publication_week_format CHECK (
                week ~ '^\\d{4}-W\\d{2}$'
                AND substring(week from 7)::int BETWEEN 1 AND 53
            ),
            ADD CONSTRAINT publication_one_per_week UNIQUE (org_id, week);
    """)
