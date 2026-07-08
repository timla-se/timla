"""Org membership for real auth (issue #3).

Maps a Clerk user id to the organization they manage. Deliberately not
using Clerk Organizations — see issue #3's design notes: the token maps
to a user only, org membership lives here so the auth backend stays
swappable for self-hosting. user_id as primary key means one org per
user for MVP; multiple different users can already reference the same
org_id (multi-admin invite flow is #29, no schema change needed there).

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-08
"""
from alembic import op

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE org_user (
            user_id text PRIMARY KEY,
            org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
            email text,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX org_user_org_idx ON org_user(org_id);
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE org_user;
    """)
