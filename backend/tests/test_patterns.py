import random
from datetime import UTC, datetime, timedelta

from app import alerts, outcomes, patterns
from tests.test_outcomes import NY, START, bar


def flat(n, price=100.0):
    return [bar(i, price, price + 1, price - 1, price) for i in range(n)]


def fired(bars, concept):
    return patterns.detect_patterns(bars)[concept].nonzero()[0].tolist()


def walk(n=900, seed=3):
    rnd = random.Random(seed)
    price, bars = 100.0, []
    for i in range(n):
        o = price * (1 + rnd.gauss(0, 0.01))
        c = o * (1 + rnd.gauss(0, 0.012))
        bars.append(bar(i, o, max(o, c) * (1 + abs(rnd.gauss(0, 0.004))), min(o, c) * (1 - abs(rnd.gauss(0, 0.004))), c, 100 + rnd.random() * 50))
        price = c
    return bars


def test_inside_and_outside_day():
    bars = flat(5) + [bar(5, 100, 103, 97, 101), bar(6, 100, 102, 98, 101.5), bar(7, 101, 102, 98, 99), bar(8, 100, 105, 95, 104)]
    assert fired(bars, "inside_day_up") == [6] and fired(bars, "inside_day_down") == []
    assert fired(bars, "outside_day_up") == [5, 8]
    assert fired(bars, "outside_day_down") == []


def test_gaps_need_one_percent():
    bars = flat(3) + [bar(3, 101.0, 102, 100, 101), bar(4, 100.0, 101, 99, 100), bar(5, 98.9, 100, 98, 99)]
    assert fired(bars, "gap_up") == [3] and fired(bars, "gap_down") == [5]


def test_breakouts_and_year_extremes():
    bars = flat(30) + [bar(30, 100, 106, 100, 105)]
    assert fired(bars, "breakout_20d_high") == [30] and fired(bars, "new_52w_high") == []
    bars = flat(260) + [bar(260, 100, 101, 90, 91)]
    assert fired(bars, "breakdown_20d_low") == [260] and fired(bars, "new_52w_low") == [260]
    assert fired(flat(15) + [bar(15, 100, 120, 100, 119)], "breakout_20d_high") == []  # needs 20 prior bars


def test_three_day_streaks():
    closes = [100, 101, 100, 99, 98, 99, 100, 101]
    bars = [bar(i, c, c + 1, c - 1, c) for i, c in enumerate(closes)]
    assert fired(bars, "three_down_days") == [4] and fired(bars, "three_up_days") == [7]


def test_rsi2_extremes():
    down = [bar(i, 100 - 3 * i, 101 - 3 * i, 98 - 3 * i, 100 - 3 * i) for i in range(5)]
    up = [bar(i, 100 + 3 * i, 102 + 3 * i, 99 + 3 * i, 100 + 3 * i) for i in range(5)]
    assert fired(down, "rsi2_oversold") == [2, 3, 4] and fired(up, "rsi2_overbought") == [2, 3, 4]
    assert fired(down, "rsi2_overbought") == [] and fired(down[:2], "rsi2_oversold") == []


def test_nr7():
    wide = [bar(i, 100, 104, 96, 100) for i in range(7)]
    bars = wide + [bar(7, 100, 100.5, 99.8, 100.3)]
    assert fired(bars, "nr7_up") == [7] and fired(bars, "nr7_down") == []


def test_200ma_crosses():
    bars = [bar(i, 100, 101, 99, 100) for i in range(210)] + [bar(210, 100, 106, 99, 105), bar(211, 105, 106, 94, 95)]
    assert fired(bars, "close_above_200ma_cross") == [210] and fired(bars, "close_below_200ma_cross") == [211]


def test_pullback_to_50ma_in_uptrend():
    bars = [bar(i, 50 + i * 0.5, 51 + i * 0.5, 49 + i * 0.5, 50 + i * 0.5) for i in range(260)]
    ma50 = sum(b.close for b in bars[-50:]) / 50
    top = bars[-1].close
    bars.append(bar(260, top, top + 1, ma50 - 0.5, ma50 + 1))
    assert fired(bars, "pullback_to_50ma_in_uptrend") == [260]
    assert fired(bars[:100], "pullback_to_50ma_in_uptrend") == []


def test_every_pattern_has_metadata_and_fires_on_a_random_walk():
    bars = walk()
    found = patterns.detect_patterns(bars)
    assert set(found) == set(patterns.PATTERNS)
    assert all(len(v) == len(bars) for v in found.values())
    for concept, (direction, group, label, text) in patterns.PATTERNS.items():
        assert direction in ("strength", "weakness") and group in ("price", "momentum") and label and text
        assert found[concept].any(), concept


def test_no_lookahead_truncating_future_bars_changes_nothing():
    bars = walk(700, seed=5)
    full = patterns.detect_patterns(bars)
    for cut in (120, 261, 400, 699):
        part = patterns.detect_patterns(bars[:cut])
        for concept in full:
            assert part[concept].tolist() == full[concept][:cut].tolist(), (concept, cut)


def test_study_and_signals_include_patterns():
    universe = {f"S{k}": walk(900, seed=k) for k in range(4)}
    records = outcomes.signals(universe["S0"], "S0")
    assert {r["concept"] for r in records} & set(patterns.PATTERNS)
    assert all(r["trend"] in ("up", "down", "flat") and r["volume_bucket"] in ("low", "normal", "high") for r in records)
    study = outcomes.run_study(universe, now=datetime(2024, 1, 1, tzinfo=UTC))
    seen = {s["concept"] for s in study["stats"]}
    assert seen & set(patterns.PATTERNS) and set(study["concepts"]) == set(patterns.PATTERNS) | set(patterns.EVENT_PATTERNS)
    s = next(s for s in study["stats"] if s["concept"] in patterns.PATTERNS and s["n_cases"] > 5)
    assert "t_stat" in s and "win_loss_ratio" in s
    assert study["breakdowns"] and {b["dimension"] for b in study["breakdowns"]} <= {"trend", "volume_bucket"}
    assert all(b["n_cases"] >= outcomes.MIN_BREAKDOWN_CASES and {"concept", "horizon", "value", "hit_rate", "edge"} <= set(b) for b in study["breakdowns"])


def test_t_stat_and_win_loss():
    assert outcomes.t_stat([0.01], 0.0) is None and outcomes.t_stat([0.01, 0.01], 0.0) is None
    assert outcomes.t_stat([0.02, 0.04, 0.03], 0.0) > 5
    rows = [{"return": 0.04}, {"return": 0.02}, {"return": -0.01}]
    assert abs(outcomes.win_loss(rows, "strength") - 3.0) < 1e-9
    assert abs(outcomes.win_loss(rows, "weakness") - 1 / 3) < 1e-9
    assert outcomes.win_loss([{"return": 0.01}], "strength") is None


def test_alerts_work_with_a_new_pattern_concept():
    bars = flat(30) + [bar(30, 100, 106, 100, 105)] + [bar(31 + k, 105, 106, 104, 105 + k) for k in range(25)]
    session = bars[30].session
    holds = [{"concept": "breakout_20d_high", "horizon": h, "holds": True} for h in outcomes.HORIZONS]
    study = {"generated_at": "x", "holds": holds,
             "stats": [{"concept": "breakout_20d_high", "horizon": h, "period": "newer", "edge": 0.1, "hit_rate": 0.6} for h in outcomes.HORIZONS]}
    made = alerts.build_alerts({"AAA": bars}, study, session)
    a = next(a for a in made if a["concept"] == "breakout_20d_high")
    assert a["direction"] == "strength" and a["holding_horizons"] == [1, 5, 20]
    assert {r["horizon"] for r in alerts.score(a, bars)} == {1, 5, 20}


def test_empty_input_gives_empty_results():
    assert all(not v.any() and len(v) == 0 for v in patterns.detect_patterns([]).values())
    assert outcomes.signals([]) == []
    assert alerts.build_alerts({"AAA": []}, {"generated_at": "x", "holds": [], "stats": []}, "2025-01-02") == []


def test_failed_breakout_events_get_one_direction_ids():
    bars = flat(30) + [bar(30, 100, 103, 99.5, 100), bar(31, 100, 100.5, 97, 100)]
    made = {(r["concept"], r["index"]): r["direction"] for r in outcomes.signals(bars)}
    assert made[("failed_breakout_high", 30)] == "weakness"
    assert made[("failed_breakout_low", 31)] == "strength"
    assert not any(c in ("failed_breakout", "breakout") for c, _ in made)
    info = patterns.concept_info()
    assert info["failed_breakout_high"]["group"] == "price" and info["failed_breakout_low"]["direction"] == "strength"
