"""Step 3.2b: ATR, volatility regime and slope-based trend (hand-computed)."""
import json

import pytest
from pydantic import ValidationError

from app.data import ingest
from app.features import features
from app.models import Parameters
from scripts.demo import demo_csv, demo_source
from tests.conftest import make_bar
from tests.test_api import upload

OLD = Parameters(trend_method="close_difference")


def flat_bar(i, c, h=None, low=None):
    return make_bar(i, o=c, h=c + 1 if h is None else h, low=c - 1 if low is None else low, c=c)


def test_defaults_and_validation():
    p = Parameters()
    assert (p.atr_period, p.regime_window, p.regime_low, p.regime_high) == (14, 100, 0.75, 1.25)
    assert p.trend_method == "slope" and p.trend_atr_threshold == 1.0
    for bad in ({"atr_period": 2}, {"atr_period": 101}, {"regime_window": 19}, {"regime_low": 1.0},
                {"regime_low": 0}, {"regime_high": 1.0}, {"regime_high": 11}, {"trend_method": "x"},
                {"trend_atr_threshold": 0}, {"trend_atr_threshold": 11}):
        with pytest.raises(ValidationError):
            Parameters(**bad)


def test_atr_with_gap_and_first_bar():
    # TR: bar0 = 2 (high-low). bar1 gaps up: high 111, low 109, prev close 100 -> max(2, 11, 9) = 11.
    # bar2: high 112, low 110, prev close 110 -> 2. bar3 and bar4: 2.
    bars = [make_bar(0, o=100, h=101, low=99, c=100), make_bar(1, o=110, h=111, low=109, c=110),
            make_bar(2, o=110, h=112, low=110, c=111), make_bar(3, o=111, h=112, low=110, c=111),
            make_bar(4, o=111, h=112, low=110, c=111)]
    f = features(bars, Parameters(atr_period=3))
    assert [x["atr"] for x in f[:3]] == [None, None, None]
    assert f[3]["atr"] == pytest.approx((2 + 11 + 2) / 3)
    assert f[4]["atr"] == pytest.approx((11 + 2 + 2) / 3)


def test_regime_classes():
    # indeterminate: not enough prior atr values for a median
    assert features([flat_bar(i, 100) for i in range(30)], Parameters())[-1]["volatility_regime"] == "indeterminate"
    base = [flat_bar(i, 100) for i in range(60)]  # TR 2 everywhere
    p = Parameters(atr_period=14, regime_window=100)

    def final(rng):
        bars = base + [flat_bar(60 + k, 100, h=100 + rng / 2, low=100 - rng / 2) for k in range(15)]
        return features(bars, p)[-1]
    # 14 prior bars of range 4 -> atr 4; median of the prior atr values stays 2 -> ratio 2
    assert final(4)["volatility_regime"] == "high"
    assert final(1)["volatility_regime"] == "low"
    assert final(2)["volatility_regime"] == "normal"
    last = final(4)
    assert last["atr"] == pytest.approx(4.0) and last["atr_median"] == pytest.approx(2.0)


def trend_bars(closes):
    return [make_bar(i, o=c, h=c + .5, low=c - .5, c=c) for i, c in enumerate(closes)]


def test_slope_up_down_flat_hand_computed():
    p = Parameters(lookback=10, minimum_history=5, atr_period=5)
    # closes rise 1 per bar; TR = max(1, |h-pc| = 1.5, |l-pc| = 0.5) = 1.5 after the first bar
    up = features(trend_bars([100 + i for i in range(20)]), p)[-1]
    assert up["trend_slope"] == pytest.approx(1.0)
    assert up["atr"] == pytest.approx(1.5)
    assert up["trend_move_atr"] == pytest.approx(1.0 * 9 / 1.5) and up["background"] == "up"
    down = features(trend_bars([100 - i for i in range(20)]), p)[-1]
    assert down["trend_slope"] == pytest.approx(-1.0) and down["background"] == "down"
    flat = features(trend_bars([100, 100.1] * 10), p)[-1]
    assert abs(flat["trend_move_atr"]) < 1 and flat["background"] == "flat"
    exact = features(trend_bars([100 + i for i in range(20)]), Parameters(
        lookback=10, minimum_history=5, atr_period=5, trend_atr_threshold=6.0))[-1]
    assert exact["trend_move_atr"] == pytest.approx(6.0) and exact["background"] == "up"
    assert features(trend_bars([100 + i for i in range(3)]), p)[2]["background"] == "indeterminate"


def test_zero_atr_is_indeterminate():
    bars = [make_bar(i, o=50, h=50, low=50, c=50) for i in range(20)]
    f = features(bars, Parameters(lookback=10, minimum_history=5, atr_period=5))[-1]
    assert f["atr"] == 0 and f["trend_move_atr"] is None and f["background"] == "indeterminate"
    assert f["volatility_regime"] == "indeterminate"


def old_background(bars, p):
    out = []
    for i in range(len(bars)):
        h = bars[max(0, i - p.lookback):i]
        prog = h[-1].close - h[0].close if len(h) >= p.minimum_history else None
        out.append("up" if prog is not None and prog > 0 else "down" if prog is not None and prog < 0 else "indeterminate")
    return out


def test_close_difference_matches_old_rule_on_demo():
    _, bars = ingest(demo_csv(), demo_source())
    assert [f["background"] for f in features(bars, OLD)] == old_background(bars, OLD)
    assert {f["background"] for f in features(bars, Parameters())} <= {"up", "down", "flat", "indeterminate"}


def test_no_lookahead():
    _, bars = ingest(demo_csv(), demo_source())
    p = Parameters()
    base = features(bars, p)
    cut = 250
    changed = list(bars)
    changed[cut] = changed[cut].model_copy(update={"high": 500.0, "low": 1.0, "close": 400.0})
    for k in range(cut + 1, len(bars)):
        changed[k] = changed[k].model_copy(update={"close": 3.0, "high": 9.0})
    other = features(changed, p)
    keys = ["atr", "atr_median", "volatility_regime", "trend_slope", "trend_move_atr", "background"]
    for i in range(cut + 1):
        assert {k: base[i][k] for k in keys} == {k: other[i][k] for k in keys}


def test_legacy_analysis_without_trend_method_reads_as_close_difference(client):
    dataset = upload(client).json()
    original = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    assert original["parameters"]["trend_method"] == "slope"
    new_keys = {"trend_method", "atr_period", "regime_window", "regime_low", "regime_high", "trend_atr_threshold"}
    legacy = {k: v for k, v in original.items() if k != "parameters"}
    legacy["id"] = "legacy-trend"
    legacy["parameters"] = {k: v for k, v in original["parameters"].items() if k not in new_keys}
    with client.app.state.store.connect() as db:
        db.execute("INSERT INTO analyses VALUES (?, ?, ?)", (legacy["id"], dataset["id"], json.dumps(legacy)))
    reopened = client.get("/api/v1/analyses/legacy-trend").json()
    assert reopened["parameters"]["trend_method"] == "close_difference"
    assert reopened["parameters"]["atr_period"] == 14
    assert client.get(f'/api/v1/analyses/{original["id"]}').json()["parameters"]["trend_method"] == "slope"
