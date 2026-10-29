from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app import markets as m

G = m.get_market("cbot_grains")
CHI = ZoneInfo("America/Chicago")


def utc(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=CHI).astimezone(timezone.utc)


def test_sunday_evening_belongs_to_monday():
    assert m.trade_date_for(utc(2026, 10, 25, 19, 0), G) == date(2026, 10, 26)
    assert m.trade_date_for(utc(2026, 10, 25, 18, 59), G) is None
    w = m.session_windows(date(2026, 10, 26), G)
    assert w[0][0] == utc(2026, 10, 25, 19, 0)


def test_boundaries():
    d = date(2026, 10, 21)  # Wednesday
    assert m.trade_date_for(utc(2026, 10, 20, 19, 0), G) == d
    assert m.trade_date_for(utc(2026, 10, 20, 18, 59), G) == date(2026, 10, 20)
    w = m.session_windows(d, G)
    assert w == [(utc(2026, 10, 20, 19, 0), utc(2026, 10, 21, 7, 45)),
                 (utc(2026, 10, 21, 8, 30), utc(2026, 10, 21, 13, 20))]
    assert not m.is_session_complete(d, utc(2026, 10, 21, 13, 19), G)
    assert m.is_session_complete(d, utc(2026, 10, 21, 13, 20), G)
    assert m.trade_date_for(utc(2026, 10, 21, 7, 45), G) == d
    assert m.trade_date_for(utc(2026, 10, 21, 8, 30), G) == d


def test_friday_close_and_weekend():
    assert m.trade_date_for(utc(2026, 10, 23, 13, 19), G) == date(2026, 10, 23)
    assert m.trade_date_for(utc(2026, 10, 23, 19, 0), G) is None
    assert m.trade_date_for(utc(2026, 10, 24, 12, 0), G) is None
    assert m.session_windows(date(2026, 10, 24), G) == []


def test_dst_sundays():
    # 2026-03-08 spring forward: Sunday 19:00 CDT = 00:00 UTC Monday
    w = m.session_windows(date(2026, 3, 9), G)
    assert w[0][0] == datetime(2026, 3, 9, 0, 0, tzinfo=timezone.utc)
    # 2026-11-01 fall back: Sunday 19:00 CST = 01:00 UTC Monday
    w = m.session_windows(date(2026, 11, 2), G)
    assert w[0][0] == datetime(2026, 11, 2, 1, 0, tzinfo=timezone.utc)
    assert m.trade_date_for(w[0][0], G) == date(2026, 11, 2)


def test_holidays():
    for d in (date(2026, 11, 26), date(2026, 4, 3), date(2026, 12, 25)):
        assert m.session_windows(d, G) == []
        assert not m.is_session_complete(d, utc(2027, 1, 1, 0, 0), G)
    assert m.trade_date_for(utc(2026, 11, 26, 10, 0), G) is None


def test_early_close_dates_flagged_not_guessed():
    assert m.possibly_incomplete(date(2026, 12, 24), G)
    assert m.possibly_incomplete(date(2026, 11, 27), G)
    assert not m.possibly_incomplete(date(2026, 10, 21), G)
    assert len(m.session_windows(date(2026, 12, 24), G)) == 2


def test_equity_uses_new_york_date():
    e = m.get_market("equity_xnys")
    ts = datetime(2026, 10, 21, 14, 30, tzinfo=timezone.utc)  # 10:30 ET
    assert m.trade_date_for(ts, e) == date(2026, 10, 21)
    assert m.session_windows(date(2026, 10, 21), e) == [
        (datetime(2026, 10, 21, 13, 30, tzinfo=timezone.utc),
         datetime(2026, 10, 21, 20, 0, tzinfo=timezone.utc))]


def test_day_after_weekday_holiday_is_flagged_possibly_incomplete():
    # Thanksgiving Thu 2026-11-26 -> Friday evening session may not exist
    assert m.possibly_incomplete(date(2026, 11, 27), G)
    # Good Friday 2026-04-03 is followed by a weekend, not a trade date
    assert not m.possibly_incomplete(date(2026, 4, 6), G)
    assert not m.possibly_incomplete(date(2026, 11, 27), m.get_market("equity_xnys"))
