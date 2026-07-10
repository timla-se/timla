"""Staff hourly wage for labor-cost reporting

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-10

Design notes (see issue #17):
- hourly_wage is nullable numeric(8,2): NULL means "no wage set" and the
  labor-cost report never guesses a wage — such staff show hours but no
  cost.
- CHECK (hourly_wage >= 0) guards against negative wages at the schema
  level; the API enforces its own upper cap.
"""
from alembic import op

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE staff
            ADD COLUMN hourly_wage numeric(8,2) CHECK (hourly_wage >= 0);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE staff
            DROP COLUMN hourly_wage;
    """)
