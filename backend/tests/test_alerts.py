from datetime import date, datetime, timedelta

from app import outcomes
from app.alerts import ROUND_TRIP_COST, build_alerts, score, track_record
from app.models import Bar
from app.store import Store

NY = outcomes.NY
START = date(2020, 1, 6)
SESSION = (START + timedelta(days=25)).isoformat()


def bar(i, o, h, l, c, v=100.0):
    d = START + timedelta(days=i)
    return Bar(timestamp=datetime(d.year, d.month, d.day, tzinfo=NY), available_at=datetime(d.year, d.month, d.day, 16, tzinfo=NY),
               session=d.isoformat(), open=o, high=h, low=l, close=c, volume=v)


def series(n_after=30, signal_at=25):
    bars = [bar(i, 100 - i * 0.5 + 0.5, 100 - i * 0.5 + 1, 100 - i * 0.5 - 1, 100 - i * 0.5) for i in range(signal_at)]
    low = min(b.low for b in bars) - 0.5
    bars.append(bar(signal_at, low + 2, low + 2.4, low, low + 1.5, 300))
    base = bars[-1].close
    bars += [bar(signal_at + k, base + k - 0.2, base + k + 0.5, base + k - 0.5, base + k) for k in range(1, n_after + 1)]
    return bars


def study(holding=("stopping_volume",), horizons=(1, 5)):
    return {"generated_at": "2020-01-01T00:00:00+00:00",
            "holds": [{"concept": c, "horizon": h, "holds": c in holding and h in horizons} for c in ("stopping_volume", "no_demand") for h in outcomes.HORIZONS],
            "stats": [{"concept": "stopping_volume", "horizon": h, "period": "newer", "edge": 0.1 * h, "hit_rate": 0.6} for h in outcomes.HORIZONS]}


def test_alert_built_for_holding_concept_only():
    alerts = build_alerts({"AAA": series()}, study(), SESSION)
    assert alerts and {a["concept"] for a in alerts} == {"stopping_volume"}
    a = next(a for a in alerts if a["concept"] == "stopping_volume")
    assert a["symbol"] == "AAA" and a["session_date"] == SESSION and a["direction"] == "strength"
    assert a["holding_horizons"] == [1, 5] and a["study_generated_at"] == "2020-01-01T00:00:00+00:00"
    assert a["entry_close"] == series()[25].close
    assert [x["horizon"] for x in a["study_newer"]] == [1, 5] and a["study_newer"][1]["edge"] == 0.5
    assert build_alerts({"AAA": series()}, study(holding=()), SESSION) == []


def test_no_lookahead_later_bars_never_change_alerts():
    full = series()
    altered = full[:26] + [bar(26 + k, 500, 900, 1, 3, 1e9) for k in range(10)]
    assert build_alerts({"AAA": full}, study(), SESSION) == build_alerts({"AAA": full[:26]}, study(), SESSION) \
        == build_alerts({"AAA": altered}, study(), SESSION)


def test_only_signals_on_the_session_bar_are_alerted():
    assert build_alerts({"AAA": series()}, study(), (START + timedelta(days=26)).isoformat()) == []


def test_alerts_are_immutable_and_outcomes_insert_once(tmp_path):
    store = Store(tmp_path / "a.db")
    store.initialize()
    a = build_alerts({"AAA": series()}, study(), SESSION)[0]
    assert store.save_alerts([a], "t1") == 1
    assert store.save_alerts([{**a, "entry_close": 999.0, "direction": "weakness"}], "t2") == 0
    saved = store.alerts_for(SESSION)
    assert len(saved) == 1 and saved[0]["entry_close"] == a["entry_close"] and saved[0]["direction"] == "strength" and saved[0]["created_at"] == "t1"
    assert [x["id"] for x in store.open_alerts()] == [saved[0]["id"]]
    rows = score(a, series())
    assert store.save_alert_outcomes(saved[0]["id"], rows, "s1") == 3
    assert store.save_alert_outcomes(saved[0]["id"], [{**r, "return": 9.0} for r in rows], "s2") == 0
    assert store.open_alerts() == []
    joined = store.alerts_with_outcomes()
    assert len(joined) == 3 and joined[0]["return"] == rows[0]["return"] and joined[0]["favorable"] is True


def test_score_only_complete_horizons():
    a = build_alerts({"AAA": series()}, study(), SESSION)[0]
    assert [r["horizon"] for r in score(a, series(n_after=30))] == [1, 5, 20]
    assert [r["horizon"] for r in score(a, series(n_after=6))] == [1, 5]
    assert score(a, series(n_after=0)) == []
    assert score({**a, "session_date": "1999-01-01"}, series()) == []
    r = score(a, series(n_after=6))[0]
    assert set(r) == {"horizon", "return", "favorable", "worst_adverse"} and r["favorable"]


def row(i, ret, direction="strength", symbol="AAA", h=1, fav=None):
    return {"symbol": symbol, "concept": "c", "direction": direction, "session_date": (START + timedelta(days=7 * i)).isoformat(),
            "horizon": h, "return": ret, "favorable": ret > 0 if fav is None else fav}


def test_track_record_net_of_cost_and_direction():
    rows = [row(i, 0.02, symbol=f"S{i}") for i in range(30)]
    t = track_record(rows, {1: [0.01, -0.01, 0.01, 0.01]})[0]
    assert t["n"] == 30 and t["verdict"] == "enough cases" and t["hit_rate"] == 1.0 and t["baseline_hit_rate"] == 0.75
    assert abs(t["mean_return"] - 0.02) < 1e-12 and abs(t["mean_return_net"] - (0.02 - ROUND_TRIP_COST)) < 1e-12
    weak = track_record([row(0, -0.02, "weakness")], {1: [-0.01, 0.01]})[0]
    assert abs(weak["mean_return"] - 0.02) < 1e-12 and abs(weak["mean_return_net"] - 0.019) < 1e-12 and weak["baseline_hit_rate"] == 0.5


def test_track_record_too_few_cases():
    t = track_record([row(i, 0.01, symbol=f"S{i}") for i in range(outcomes.MIN_CASES - 1)], {1: [0.01]})[0]
    assert t["n"] == outcomes.MIN_CASES - 1 and t["verdict"] == "too few cases yet"


def test_track_record_dedupes_overlapping_alerts():
    close = [{**row(0, 0.01, h=5), "session_date": (START + timedelta(days=d)).isoformat()} for d in (0, 1, 2)]
    far = [{**row(0, 0.01, h=5), "session_date": (START + timedelta(days=14)).isoformat()}]
    assert track_record(close, {})[0]["n"] == 1
    assert track_record(close + far, {})[0]["n"] == 2
    assert track_record(close, {})[0]["baseline_hit_rate"] is None
