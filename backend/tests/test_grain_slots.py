from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from app.markets import grain_slot, tpo_period

CHI = ZoneInfo("America/Chicago")


def ct(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=CHI).astimezone(timezone.utc)


def test_30m_evening_and_day():
    s = grain_slot(ct(2026, 10, 27, 19, 0), 30)
    assert (s.trade_date, s.session_index, s.slot_index, s.is_short) == (date(2026, 10, 28), 0, 0, False)
    last = grain_slot(ct(2026, 10, 28, 7, 30), 30)
    assert last.is_short and last.is_last_slot and last.slot_index == 25
    assert last.expected_end_utc == ct(2026, 10, 28, 7, 45)
    first_day = grain_slot(ct(2026, 10, 28, 8, 30), 30)
    assert first_day.session_index == 1 and first_day.slot_index == 0 and not first_day.is_short
    end = grain_slot(ct(2026, 10, 28, 13, 0), 30)
    assert end.is_short and end.is_last_slot and end.expected_end_utc == ct(2026, 10, 28, 13, 20)
    assert not grain_slot(ct(2026, 10, 28, 12, 30), 30).is_last_slot


def test_15m_and_5m_shorts():
    assert grain_slot(ct(2026, 10, 28, 7, 30), 15).is_short is False
    assert grain_slot(ct(2026, 10, 28, 7, 30), 15).is_last_slot
    d = grain_slot(ct(2026, 10, 28, 13, 15), 15)
    assert d.is_short and d.expected_end_utc == ct(2026, 10, 28, 13, 20)
    for h, m in [(7, 40), (13, 15), (19, 0), (8, 30)]:
        day = 27 if h == 19 else 28
        assert not grain_slot(ct(2026, 10, day, h, m), 5).is_short
    assert grain_slot(ct(2026, 10, 28, 7, 40), 5).is_last_slot


@pytest.mark.parametrize("sunday,monday", [((2026, 11, 1), (2026, 11, 2)), ((2027, 3, 14), (2027, 3, 15))])
def test_dst_weeks(sunday, monday):
    y, m, d = sunday
    s = grain_slot(ct(y, m, d, 19, 0), 30)
    assert s.trade_date == date(*monday) and s.slot_index == 0
    assert tpo_period(ct(y, m, d, 19, 0)) == 0
    y, m, d = monday
    assert tpo_period(ct(y, m, d, 7, 30)) == 25
    assert tpo_period(ct(y, m, d, 8, 30)) == 27
    assert tpo_period(ct(y, m, d, 13, 0)) == 36
    assert grain_slot(ct(y, m, d, 8, 30), 30).slot_index == 0


def test_dst_utc_instants():
    assert ct(2026, 11, 1, 19, 0) == datetime(2026, 11, 2, 1, 0, tzinfo=timezone.utc)  # CST
    assert ct(2026, 10, 31, 19, 0) == datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)  # CDT
    assert ct(2027, 3, 14, 19, 0) == datetime(2027, 3, 15, 0, 0, tzinfo=timezone.utc)  # CDT


@pytest.mark.parametrize("stamp,step,msg", [
    (ct(2026, 10, 28, 7, 45), 30, "break"),
    (ct(2026, 10, 28, 8, 0), 30, "break"),
    (ct(2026, 10, 28, 13, 20), 30, "after"),
    (ct(2026, 10, 30, 13, 20), 30, "Friday"),
    (ct(2026, 10, 30, 19, 0), 30, "closed"),
    (ct(2026, 10, 31, 12, 0), 30, "closed"),
    (ct(2026, 11, 1, 18, 30), 30, "closed"),
    (ct(2026, 11, 25, 19, 0), 30, "closed"),  # evening before Thanksgiving trade date
    (ct(2026, 11, 26, 9, 0), 30, "closed"),
    (ct(2026, 10, 27, 19, 10), 30, "aligned"),
    (ct(2026, 10, 27, 19, 0), 60, "step"),
    (ct(2026, 10, 27, 19, 0), 1, "step"),
])
def test_rejected(stamp, step, msg):
    with pytest.raises(ValueError, match=msg):
        grain_slot(stamp, step)


def test_naive_rejected():
    with pytest.raises(ValueError):
        grain_slot(datetime(2026, 10, 28, 15, 0), 30)


def test_tpo_period_values_and_minutes():
    assert tpo_period(ct(2026, 10, 27, 19, 0)) == 0
    assert tpo_period(ct(2026, 10, 28, 7, 30)) == 25
    assert tpo_period(ct(2026, 10, 28, 8, 30)) == 27
    assert tpo_period(ct(2026, 10, 28, 13, 0)) == 36
    with pytest.raises(ValueError):
        tpo_period(ct(2026, 10, 28, 8, 30), minutes=15)
