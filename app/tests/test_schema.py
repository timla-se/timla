"""Schema/constraint tests. Require a migrated database (alembic upgrade
head against DATABASE_URL); skipped when no database is reachable so the
pure-unit suite still runs anywhere. CI always provides one.

All mutations run inside a rolled-back transaction — no residue.
"""
import psycopg
import pytest

from config import DATABASE_URL


def _db_available():
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=2):
            return True
    except psycopg.OperationalError:
        return False


pytestmark = pytest.mark.skipif(not _db_available(), reason='no database reachable at DATABASE_URL')

TABLES = ['organization', 'org_rule', 'staff', 'shift', 'availability_interval', 'publication']


@pytest.fixture
def db():
    conn = psycopg.connect(DATABASE_URL)
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture
def org_id(db):
    with db.cursor() as cur:
        cur.execute("INSERT INTO organization (name) VALUES ('Testorg') RETURNING id")
        return cur.fetchone()[0]


@pytest.fixture
def staff_id(db, org_id):
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO staff (org_id, name) VALUES (%s, 'Test Person') RETURNING id",
            (org_id,),
        )
        return cur.fetchone()[0]


def test_migration_created_all_tables(db):
    with db.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        )
        existing = {row[0] for row in cur.fetchall()}
    assert set(TABLES) <= existing


def test_org_timezone_defaults_to_stockholm(db, org_id):
    with db.cursor() as cur:
        cur.execute('SELECT timezone FROM organization WHERE id = %s', (org_id,))
        assert cur.fetchone()[0] == 'Europe/Stockholm'


def test_shift_rejects_negative_span(db, org_id):
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.cursor() as cur:
            cur.execute(
                """INSERT INTO shift (org_id, starts_at, ends_at)
                   VALUES (%s, '2026-07-11T18:00Z', '2026-07-11T17:00Z')""",
                (org_id,),
            )


def test_dated_wish_is_allowed(db, org_id, staff_id):
    # Issue #40 dropped availability_wish_is_recurring: a dated wish
    # ("Kan extra") is now legal — the 2x2 matrix is complete.
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO availability_interval
                   (org_id, staff_id, kind, on_date, start_minute, end_minute)
               VALUES (%s, %s, 'wish', '2026-07-15', 0, 1440) RETURNING id""",
            (org_id, staff_id),
        )
        assert cur.fetchone()[0] is not None


def test_source_check_rejects_unknown_value(db, org_id, staff_id):
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.cursor() as cur:
            cur.execute(
                """INSERT INTO availability_interval
                       (org_id, staff_id, kind, weekday, start_minute, end_minute, source)
                   VALUES (%s, %s, 'wish', 1, 540, 1020, 'robot')""",
                (org_id, staff_id),
            )


def test_source_allows_null_and_known_values(db, org_id, staff_id):
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO availability_interval
                   (org_id, staff_id, kind, weekday, start_minute, end_minute, source)
               VALUES (%s, %s, 'wish', 1, 540, 1020, NULL),
                      (%s, %s, 'block', 7, 0, 1440, 'manager'),
                      (%s, %s, 'wish', 2, 540, 1020, 'staff') RETURNING id""",
            (org_id, staff_id) * 3,
        )
        assert len(cur.fetchall()) == 3


def test_desired_shifts_per_week_check(db, org_id):
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO staff (org_id, name, desired_shifts_per_week) VALUES (%s, 'X', 51)",
                (org_id,),
            )


def test_availability_is_recurring_xor_dated(db, org_id, staff_id):
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.cursor() as cur:
            cur.execute(
                """INSERT INTO availability_interval
                       (org_id, staff_id, kind, weekday, on_date, start_minute, end_minute)
                   VALUES (%s, %s, 'block', 7, '2026-07-15', 0, 1440)""",
                (org_id, staff_id),
            )


def test_dated_block_is_allowed(db, org_id, staff_id):
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO availability_interval
                   (org_id, staff_id, kind, on_date, start_minute, end_minute)
               VALUES (%s, %s, 'block', '2026-07-15', 0, 1440) RETURNING id""",
            (org_id, staff_id),
        )
        assert cur.fetchone()[0] is not None


def _insert_publication(cur, org_id, start, end):
    cur.execute(
        """INSERT INTO publication (org_id, period_start, period_end, shifts)
           VALUES (%s, %s, %s, '[]') RETURNING id""",
        (org_id, start, end),
    )
    return cur.fetchone()[0]


def test_publication_rejects_non_positive_span(db, org_id):
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.cursor() as cur:
            _insert_publication(cur, org_id, '2026-07-06', '2026-07-06')


def test_publication_rejects_over_one_year_span(db, org_id):
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.cursor() as cur:
            _insert_publication(cur, org_id, '2026-01-01', '2027-01-03')


def test_publication_rejects_overlap_within_org(db, org_id):
    with pytest.raises(psycopg.errors.ExclusionViolation):
        with db.cursor() as cur:
            _insert_publication(cur, org_id, '2026-07-06', '2026-07-20')
            _insert_publication(cur, org_id, '2026-07-13', '2026-07-27')


def test_publication_allows_adjacent_ranges_and_other_org(db, org_id, other_org_id):
    with db.cursor() as cur:
        # end-exclusive storage: [06, 13) and [13, 20) are adjacent, not overlapping
        _insert_publication(cur, org_id, '2026-07-06', '2026-07-13')
        _insert_publication(cur, org_id, '2026-07-13', '2026-07-20')
        # the same range in another org is fine — the constraint is per org
        _insert_publication(cur, other_org_id, '2026-07-06', '2026-07-13')
        cur.execute('SELECT count(*) FROM publication WHERE org_id IN (%s, %s)', (org_id, other_org_id))
        assert cur.fetchone()[0] == 3


@pytest.mark.parametrize('week, monday', [
    ('2026-W01', '2025-12-29'),  # year-boundary ISO week
    ('2026-W28', '2026-07-06'),
    ('2020-W53', '2020-12-28'),  # long ISO year
])
def test_iso_week_backfill_expression_gives_monday(db, week, monday):
    # Pins the 0004 backfill's parsing rule: to_date(week, 'IYYY-"W"IW')
    # must yield the ISO week's Monday.
    with db.cursor() as cur:
        cur.execute("""SELECT to_date(%s, 'IYYY-"W"IW')""", (week,))
        assert cur.fetchone()[0].isoformat() == monday


@pytest.fixture
def other_org_id(db):
    with db.cursor() as cur:
        cur.execute("INSERT INTO organization (name) VALUES ('Other org') RETURNING id")
        return cur.fetchone()[0]


def test_shift_staff_must_belong_to_same_org(db, staff_id, other_org_id):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with db.cursor() as cur:
            cur.execute(
                """INSERT INTO shift (org_id, staff_id, starts_at, ends_at)
                   VALUES (%s, %s, '2026-07-11T18:00Z', '2026-07-11T20:00Z')""",
                (other_org_id, staff_id),
            )


def test_availability_staff_must_belong_to_same_org(db, staff_id, other_org_id):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with db.cursor() as cur:
            cur.execute(
                """INSERT INTO availability_interval
                       (org_id, staff_id, kind, weekday, start_minute, end_minute)
                   VALUES (%s, %s, 'block', 7, 0, 1440)""",
                (other_org_id, staff_id),
            )


def test_deleting_staff_leaves_shift_as_open(db, org_id, staff_id):
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO shift (org_id, staff_id, starts_at, ends_at)
               VALUES (%s, %s, '2026-07-11T18:00Z', '2026-07-12T02:00Z') RETURNING id""",
            (org_id, staff_id),
        )
        shift_id = cur.fetchone()[0]
        cur.execute('DELETE FROM staff WHERE id = %s', (staff_id,))
        cur.execute('SELECT staff_id, org_id FROM shift WHERE id = %s', (shift_id,))
        remaining_staff, remaining_org = cur.fetchone()
        # Only staff_id is nulled by the composite FK; the shift stays in its org.
        assert remaining_staff is None
        assert remaining_org == org_id
