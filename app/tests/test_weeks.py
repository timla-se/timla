from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from weeks import (expand_interval, iso_week_of, local_instant, month_bounds_utc,
                   week_bounds_utc, week_monday)

TZ = 'Europe/Stockholm'
STHLM = ZoneInfo(TZ)


def local(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=STHLM)


def test_overnight_shift_belongs_to_week_where_it_starts():
    # Saturday 2026-07-11 18:00 → Sunday 02:00 is a W28 shift.
    assert iso_week_of(local(2026, 7, 11, 18), TZ) == '2026-W28'
    # A shift starting late Sunday is still W28...
    assert iso_week_of(local(2026, 7, 12, 23), TZ) == '2026-W28'
    # ...but one starting after midnight Monday is W29.
    assert iso_week_of(local(2026, 7, 13, 0, 30), TZ) == '2026-W29'


def test_week_evaluated_in_org_timezone_not_utc():
    # Sunday 22:30 UTC is already Monday 00:30 in Stockholm (CEST, +2).
    utc_sunday_evening = datetime(2026, 7, 12, 22, 30, tzinfo=timezone.utc)
    assert iso_week_of(utc_sunday_evening, TZ) == '2026-W29'


def test_week_bounds_are_dst_aware():
    def hours(week):
        start, end = week_bounds_utc(week, TZ)
        return (end - start).total_seconds() / 3600

    assert hours('2026-W28') == 168
    # Spring transition (2026-03-29) falls in W13: one hour is skipped.
    assert hours('2026-W13') == 167
    # Autumn transition (2026-10-25) falls in W43: one hour repeats.
    assert hours('2026-W43') == 169


def test_week_monday():
    assert week_monday('2026-W28').isoformat() == '2026-07-06'
    assert week_monday('2026-W01').isoformat() == '2025-12-29'


def test_expand_interval_follows_dst_offset():
    # 08:00–16:00 wall clock is 07:00–15:00 UTC in winter...
    start, end = expand_interval(week_monday('2026-W02'), 480, 960, TZ)
    assert (start.hour, end.hour) == (7, 15)
    # ...and 06:00–14:00 UTC in summer.
    start, end = expand_interval(week_monday('2026-W28'), 480, 960, TZ)
    assert (start.hour, end.hour) == (6, 14)


def test_minute_1440_is_next_midnight():
    from datetime import date
    day = date(2026, 7, 11)
    assert local_instant(day, 1440, TZ) == local_instant(date(2026, 7, 12), 0, TZ)


def test_month_bounds_normal_month():
    start, end = month_bounds_utc('2026-07', TZ)
    assert start == local(2026, 7, 1, 0).astimezone(timezone.utc)
    assert end == local(2026, 8, 1, 0).astimezone(timezone.utc)
    assert (end - start).total_seconds() / 3600 == 31 * 24


def test_month_bounds_year_rollover():
    start, end = month_bounds_utc('2026-12', TZ)
    assert start == local(2026, 12, 1, 0).astimezone(timezone.utc)
    assert end == local(2027, 1, 1, 0).astimezone(timezone.utc)


def test_month_bounds_are_dst_aware():
    def hours(month):
        start, end = month_bounds_utc(month, TZ)
        return (end - start).total_seconds() / 3600

    # Spring transition (2026-03-29): one hour is skipped.
    assert hours('2026-03') == 31 * 24 - 1
    # Autumn transition (2026-10-25): one hour repeats.
    assert hours('2026-10') == 31 * 24 + 1


@pytest.mark.parametrize('bad', ['2026-7', '2026-13', '2026-00', '2026-07-01',
                                 'garbage', '', '2026-W28', '202-07'])
def test_month_bounds_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        month_bounds_utc(bad, TZ)


def test_dst_gap_wall_time_is_normalized_not_an_error():
    # 02:30 on 2026-03-29 does not exist in Stockholm (clocks jump 02→03).
    from datetime import date
    instant = local_instant(date(2026, 3, 29), 150, TZ)
    # zoneinfo fold rules resolve it deterministically instead of raising.
    assert instant.tzinfo == timezone.utc
