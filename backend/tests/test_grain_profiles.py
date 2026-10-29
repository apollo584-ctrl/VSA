from datetime import timedelta

import pandas as pd
import pytest

from app.models import Bar, Parameters, Source
from app.profiles import ProfileLimitError, profile, profiles

CHI = "America/Chicago"


def src(contract="ZCZ27", step=30):
    return Source(instrument=contract, timeframe_minutes=step, exchange="CBOT", market="cbot_grains",
                  contract=contract, timezone=CHI, price_adjustment="unadjusted", volume_adjustment="raw",
                  source_name="test")


def bar(local, session, o, h, low, c, volume=100.0, step=30):
    stamp = pd.Timestamp(local, tz=CHI).tz_convert("UTC").to_pydatetime()
    return Bar(timestamp=stamp, available_at=stamp + timedelta(minutes=step), session=session,
               open=o, high=h, low=low, close=c, volume=volume)


D1, D2 = "2026-11-03", "2026-11-04"


def test_hand_computed_bins_tick_and_two_ticks():
    bars = [bar("2026-11-02 19:00", D1, 450.0, 450.5, 450.0, 450.25, 60),
            bar("2026-11-03 08:30", D1, 450.25, 451.0, 450.25, 451.0, 90)]
    one = profile(bars, src(), Parameters(bin_size=0.25))
    # bar 1 (period 0) touches 450.0-450.5 = 3 bins x 20; bar 2 (period 27, 08:30 CT) touches 450.25-451.0 = 4 bins x 22.5
    assert one.price_bin_lower == [450.0, 450.25, 450.5, 450.75, 451.0]
    assert one.price_bin_center == [450.125, 450.375, 450.625, 450.875, 451.125]
    assert one.volume.counts == pytest.approx([20, 42.5, 42.5, 22.5, 22.5])
    assert one.tpo.counts == [1, 2, 2, 1, 1]
    assert one.single_print_bins == [450.125, 450.875, 451.125]
    two = profile(bars, src(), Parameters(bin_size=0.5))
    assert two.price_bin_lower == [450.0, 450.5, 451.0]
    assert two.price_bin_center == [450.25, 450.75, 451.25]
    assert two.volume.counts == pytest.approx([60, 60, 30])
    assert two.tpo.counts == [2, 2, 1]


def test_bin_size_must_be_tick_multiple():
    bars = [bar("2026-11-03 08:30", D1, 450, 451, 450, 451)]
    with pytest.raises(ValueError, match="multiple of the tick"):
        profile(bars, src(), Parameters(bin_size=0.3))
    with pytest.raises(ValueError, match="multiple of the tick"):
        profile(bars, src(), Parameters(bin_size=0.1))


def test_tpo_must_be_30_for_grain():
    bars = [bar("2026-11-03 08:30", D1, 450, 451, 450, 451)]
    with pytest.raises(ValueError):
        profile(bars, src(), Parameters(bin_size=0.25, tpo_minutes=60))


@pytest.mark.parametrize("step", [5, 15, 30])
def test_all_timeframes_and_period_boundary(step):
    starts = ["2026-11-02 19:00", "2026-11-03 08:30"]
    bars = [bar(s, D1, 450.0, 450.0, 450.0, 450.0, 10, step) for s in starts]
    # a second bar inside the same 30-minute period must not add a TPO
    later = pd.Timestamp("2026-11-03 08:30") + pd.Timedelta(minutes=step if step < 30 else 0)
    if step < 30:
        bars.append(bar(str(later), D1, 450.0, 450.0, 450.0, 450.0, 10, step))
    result = profile(bars, src(step=step), Parameters(bin_size=0.25))
    assert result.tpo.counts == [2]  # periods 0 and 27 -> two distinct TPOs in one bin


def test_two_trade_dates_two_profiles_and_composite():
    bars = [bar("2026-11-02 19:00", D1, 450.0, 450.5, 450.0, 450.5),
            bar("2026-11-03 08:30", D1, 450.5, 451.0, 450.5, 451.0),
            bar("2026-11-03 19:00", D2, 452.0, 452.25, 452.0, 452.25)]
    result = profiles(bars, src(), Parameters(bin_size=0.25))
    assert [r.session for r in result] == [D1, D2]
    assert result[0].id == f"profile:session:{D1}:{D1}"
    composite = profile(bars, src(), Parameters(bin_size=0.25), scope="composite")
    assert composite.session == f"{D1}/{D2}"
    assert composite.price_bin_lower[0] == 450.0 and composite.price_bin_lower[-1] == 452.25
    assert sum(composite.volume.counts) == pytest.approx(300)


def test_short_slots_are_one_period_each():
    bars = [bar("2026-11-03 07:30", D1, 450.0, 450.0, 450.0, 450.0, 5, 30),
            bar("2026-11-03 13:00", D1, 450.0, 450.0, 450.0, 450.0, 5, 30)]
    result = profile(bars, src(), Parameters(bin_size=0.25))
    assert result.tpo.counts == [2]


def test_initial_balance_not_computed_and_note():
    result = profile([bar("2026-11-03 08:30", D1, 450, 451, 450, 451)], src(), Parameters(bin_size=0.25))
    assert result.initial_balance == {"high": None, "low": None, "complete": False,
                                      "method": "not computed for grain sessions"}
    assert result.range_extension == {"above": None, "below": None}
    assert any("estimated" in note for note in result.limitations)
    assert not any(w in " ".join(result.limitations).lower() for w in ("buy", "sell"))


def test_float32_price_lands_in_its_bin_and_is_not_modified():
    b = bar("2026-11-03 08:30", D1, 67.69000244140625, 67.69000244140625, 67.69000244140625, 67.69000244140625)
    result = profile([b], src("ZLZ27"), Parameters(bin_size=0.01))
    assert result.price_bin_lower == [67.69]
    assert result.price_bin_center == [67.695]
    assert b.high == 67.69000244140625


def test_zr_half_tick_bins():
    bars = [bar("2026-11-03 08:30", D1, 12.305, 12.32, 12.305, 12.32)]
    result = profile(bars, src("ZRX27"), Parameters(bin_size=0.005))
    assert result.price_bin_lower == [12.305, 12.31, 12.315, 12.32]


def test_bin_limit():
    bars = [bar("2026-11-03 08:30", D1, 400, 1000, 400, 1000)]
    with pytest.raises(ProfileLimitError):
        profile(bars, src(), Parameters(bin_size=0.25))
