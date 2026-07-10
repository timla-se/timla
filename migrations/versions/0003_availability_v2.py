"""Availability v2: full wish/block × recurring/dated matrix + provenance + staff params

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-09

Design notes (see issue #40):
- The 2×2 matrix: {wish, block} × {recurring (weekday), dated (on_date)}.
  Dropping availability_wish_is_recurring makes a dated wish ("Kan extra")
  legal; every other combination already worked.
- Provenance: availability_interval.source is 'staff' | 'manager', NULLABLE
  with NO backfill — existing rows are genuinely of unknown origin (both
  surfaces wrote them), so the UI renders no "Inlagt av" badge for them.
- note (<= 500) is the free-text reason on an exception. The length CHECK is
  belt-and-braces behind the API cap, since note is writable from the
  unauthenticated /svar surface.
- staff.desired_shifts_per_week (0-50, NULL = unspecified) and
  staff.availability_note (<= 1000) are per-staff parameters mirroring
  staff.max_hours_per_week; the conflict engine ignores them (a future
  suggest-schedule, #11, reads desired_shifts_per_week).

Downgrade is data-lossy: dated wishes cannot satisfy the re-added CHECK, so
they are deleted before the constraint is restored.
"""
from alembic import op

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE availability_interval
            DROP CONSTRAINT availability_wish_is_recurring;
        ALTER TABLE availability_interval
            ADD COLUMN source text CHECK (source IN ('staff', 'manager')),
            ADD COLUMN note text CHECK (char_length(note) <= 500);
        ALTER TABLE staff
            ADD COLUMN desired_shifts_per_week smallint
                CHECK (desired_shifts_per_week BETWEEN 0 AND 50),
            ADD COLUMN availability_note text
                CHECK (char_length(availability_note) <= 1000);
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM availability_interval WHERE kind = 'wish' AND on_date IS NOT NULL;
        ALTER TABLE availability_interval
            ADD CONSTRAINT availability_wish_is_recurring
                CHECK (kind = 'block' OR on_date IS NULL);
        ALTER TABLE availability_interval
            DROP COLUMN source,
            DROP COLUMN note;
        ALTER TABLE staff
            DROP COLUMN desired_shifts_per_week,
            DROP COLUMN availability_note;
    """)
