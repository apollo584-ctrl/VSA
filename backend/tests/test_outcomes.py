import json
from datetime import UTC, date, datetime, timedelta

import pytest

from app import outcomes
from app.models import Bar
from app.outcomes import dedupe, fetch_daily, forward, run_study, signals
from app.providers import ProviderUnavailable, SymbolNotFound

NY = outcomes.NY
START = date(2020, 1, 6)


def bar(i, o, h, l, c, v=100.0):
    d = START + timedelta(days=i)
    return Bar(timestamp=datetime(d.year, d.month, d.day, tzinfo=NY), available_at=datetime(d.year, d.month, d.day, 16, tzinfo=NY),
               session=d.isoformat(), open=o, high=h, low=l, close=c, volume=v)


def series(n_after=30, signal_at=25, tail_close=None):
    """Falling market, then a stopping-volume bar at signal_at, then a drifting tail."""
    bars = [bar(i, 100 - i * 0.5 + 0.5, 100 - i * 0.5 + 1, 100 - i * 0.5 - 1, 100 - i * 0.5) for i in range(signal_at)]
    low = min(b.low for b in bars) - 0.5
    bars.append(bar(signal_at, low + 2, low + 2.4, low, low + 1.5, 300))
    base = bars[-1].close
    for k in range(1, n_after + 1):
        c = tail_close(k, base) if tail_close else base + k
        bars.append(bar(signal_at + k, c - 0.2, c + 0.5, c - 0.5, c))
    return bars


def test_signal_found_with_context():
    found = [s for s in signals(series(), "AAA") if s["index"] == 25]
    assert {s["concept"] for s in found} >= {"stopping_volume"}
    s = next(s for s in found if s["concept"] == "stopping_volume")
    assert s["direction"] == "strength" and s["symbol"] == "AAA" and s["date"] == (START + timedelta(days=25)).isoformat()
    assert s["trend"] == "down" and s["range_position"] == "inside" and s["volume_bucket"] == "high"
    assert all(x["direction"] in ("strength", "weakness") for x in signals(series(), "AAA"))


def test_causality_later_bars_do_not_change_signal():
    full = series()
    cut = full[:26]
    altered = full[:26] + [bar(26 + k, 500, 900, 1, 3, 1e9) for k in range(10)]
    key = lambda r: {(s["concept"], s["date"], s["trend"], s["range_position"], s["volume_bucket"]) for s in r if s["index"] <= 25}
    assert key(signals(full)) == key(signals(cut)) == key(signals(altered))


def test_forward_return_math_and_adverse():
    bars = series()
    close = bars[25].close
    r = forward(bars, 25, 5, "strength")
    assert r["return"] == pytest.approx(bars[30].close / close - 1) and r["favorable"] is True
    assert r["worst_adverse"] == pytest.approx(max(0.0, 1 - min(b.low for b in bars[26:31]) / close))
    w = forward(bars, 25, 5, "weakness")
    assert w["favorable"] is False and w["worst_adverse"] == pytest.approx(max(b.high for b in bars[26:31]) / close - 1)
    assert forward(bars, len(bars) - 3, 5, "strength") is None
    assert forward(bars, 25, 20, "strength") is not None


def test_dedupe_keeps_first_in_window():
    rows = [{"symbol": "A", "concept": "c", "horizon": h, "index": i} for h in (5, 20) for i in (10, 12, 15, 40)]
    kept = dedupe(rows)
    got = {(r["horizon"], r["index"]) for r in kept}
    assert got == {(5, 10), (5, 15), (5, 40), (20, 10), (20, 40)}
    other = dedupe(rows + [{"symbol": "B", "concept": "c", "horizon": 5, "index": 12}])
    assert (5, 12) in {(r["horizon"], r["index"]) for r in other if r["symbol"] == "B"}


def test_study_baseline_split_and_holds():
    study = run_study({"AAA": series(60), "BBB": series(60)}, now=datetime(2021, 1, 1, tzinfo=UTC))
    json.dumps(study)
    assert study["symbols_used"] == ["AAA", "BBB"] and study["date_range"]["start"] == START.isoformat()
    dates = [(START + timedelta(days=i)).isoformat() for i in range(26 + 60)]
    assert study["cutoff_date"] == dates[int(len(dates) * 0.7)]
    assert study["method_notes"] and "generated_at" in study
    s = next(s for s in study["stats"] if s["concept"] == "stopping_volume" and s["horizon"] == 5)
    assert s["period"] == "older" and s["n_cases"] == 2 and s["hit_rate"] == 1.0 and s["holds"] is False
    assert s["mean_return"] == pytest.approx(s["median_return"]) and s["mean_return"] > 0
    assert 0 < s["baseline_hit_rate"] < 1 and s["edge"] == pytest.approx(s["hit_rate"] - s["baseline_hit_rate"])


def test_holds_requires_30_cases_in_both_periods_with_positive_edge(monkeypatch):
    def fake(bars, symbol="", p=None):
        return [{"symbol": symbol, "date": bars[i].session, "index": i, "concept": "x", "direction": "strength",
                 "trend": "up", "range_position": "inside", "volume_bucket": "normal"} for i in range(0, 780, 10)]
    monkeypatch.setattr(outcomes, "signals", fake)
    bars = [bar(i, 100, 101, 99, 100 + (i % 7) * 0.1 + (i * 0.05 if i % 10 else 3)) for i in range(800)]
    many = {f"S{k}": bars for k in range(3)}
    study = run_study(many)
    h1 = [s for s in study["stats"] if s["horizon"] == 1]
    assert {s["period"] for s in h1} == {"older", "newer"} and all(s["n_cases"] >= 30 for s in h1)
    assert all(s["holds"] == all(t["edge"] > 0 for t in h1) for s in h1)
    few = run_study({"S0": bars})
    assert all(s["holds"] is False for s in few["stats"])


FIXTURE = {"chart": {"error": None, "result": [{
    "meta": {"symbol": "AAA"},
    "timestamp": [1578321000, 1578407400, 1578493800, 1578580200],
    "indicators": {"quote": [{"open": [10, None, 11, 12], "high": [11, None, 12, 13], "low": [9, None, 10, 11],
                              "close": [10.5, None, 11.5, 12.5], "volume": [100, None, 200, 300]}]}}]}}


def test_fetch_daily_parses_and_drops_null_and_open_bars():
    now = datetime(2020, 1, 9, 20, tzinfo=UTC)
    bars = fetch_daily("AAA", lambda url: json.dumps(FIXTURE).encode(), now=now)
    assert [b.session for b in bars] == ["2020-01-06", "2020-01-08"]
    b = bars[0]
    assert b.timestamp == datetime(2020, 1, 6, tzinfo=NY) and b.available_at == datetime(2020, 1, 6, 16, tzinfo=NY)
    early = datetime(2020, 1, 8, 19, tzinfo=UTC)
    assert [b.session for b in fetch_daily("AAA", lambda url: json.dumps(FIXTURE).encode(), now=early)] == ["2020-01-06"]


def test_fetch_daily_errors():
    missing = {"chart": {"result": None, "error": {"code": "Not Found"}}}
    with pytest.raises(SymbolNotFound):
        fetch_daily("ZZZ", lambda url: json.dumps(missing).encode())
    with pytest.raises(ProviderUnavailable):
        fetch_daily("AAA", lambda url: b"not json")
    with pytest.raises(ProviderUnavailable):
        fetch_daily("BBB", lambda url: json.dumps(FIXTURE).encode())
