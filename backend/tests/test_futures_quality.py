from datetime import date
from zoneinfo import ZoneInfo

from app import markets
from app.data import ingest
from app.models import Source
from tests.test_futures_ingest import chicago_stamp, intraday_csv, src

CHI = ZoneInfo("America/Chicago")


def run(dates, step=30, **kw):
    return ingest(intraday_csv(dates, step, **kw), src(timeframe=step))[0]


def test_quiet_gap_is_not_missing():
    d = run([date(2026, 10, 27)], skip=lambda t: t.astimezone(CHI).hour == 3)
    assert d.quality.missing_bars == 0 and d.quality.incomplete_sessions == []
    assert any("Quiet periods with no trades" in w for w in d.quality.warnings)
    assert d.data_grade == "B"


def test_absent_session_reported():
    d = run([date(2026, 10, 26), date(2026, 10, 28)])
    assert d.quality.absent_sessions == ["2026-10-27"]


def test_incomplete_sessions_day_only_and_evening_only():
    def skip(t):
        slot = markets.grain_slot(t, 30)
        if slot.trade_date == date(2026, 10, 27):
            return slot.session_index == 0  # keeps only its day session
        return slot.session_index == 1      # 28th keeps only its evening session
    d = run([date(2026, 10, 27), date(2026, 10, 28)], skip=skip)
    assert d.quality.incomplete_sessions == ["2026-10-27", "2026-10-28"]


def test_thin_trading_over_thirty_percent():
    # drop every bar in hours 0-5 and 9 (>30% of the 36 slots)
    d = run([date(2026, 10, 27)], skip=lambda t: t.astimezone(CHI).hour in (0, 1, 2, 3, 4, 5, 9))
    assert d.data_grade == "B"
    assert any("Thin trading" in x for x in d.limitations)


def test_not_thin_at_or_below_thirty_percent():
    d = run([date(2026, 10, 27)], skip=lambda t: t.astimezone(CHI).hour == 2)
    assert not any("Thin trading" in x for x in d.limitations)


def test_zero_volume_moving_limitation_keeps_grade_b():
    def line(t):
        vol = 0 if t.astimezone(CHI).hour == 0 else 10
        return f"{chicago_stamp(t)},430.25,430.50,430.00,430.25,{vol}"
    d = run([date(2026, 10, 27)], line=line)
    assert d.data_grade == "B"
    assert any("zero-volume" in x.lower() for x in d.limitations)


def test_placeholder_lowers_to_c():
    def line(t):
        if t.astimezone(CHI).hour == 0:
            return f"{chicago_stamp(t)},430.25,430.25,430.25,430.25,0"
        return f"{chicago_stamp(t)},430.25,430.50,430.00,430.25,10"
    d = run([date(2026, 10, 27)], line=line)
    assert d.data_grade == "C" and any("placeholder" in x for x in d.limitations)


def test_off_grid_lowers_to_c():
    d = run([date(2026, 10, 27)], line=lambda t: f"{chicago_stamp(t)},430.10,430.50,430.00,430.25,10")
    assert d.data_grade == "C" and any("off the contract tick grid" in x for x in d.limitations)


def test_float32_prices_stay_on_grid_for_zl():
    s = Source(instrument="ZLZ26", timeframe_minutes=30, exchange="CBOT", market="cbot_grains", contract="ZLZ26",
               timezone="America/Chicago", price_adjustment="unadjusted", volume_adjustment="raw", source_name="t")
    body = intraday_csv([date(2026, 10, 27)], 30,
                        line=lambda t: f"{chicago_stamp(t)},67.69000244140625,67.70999908447266,"
                                       "67.66999816894531,67.69000244140625,10")
    d = ingest(body, s)[0]
    assert d.data_grade == "B", d.limitations
