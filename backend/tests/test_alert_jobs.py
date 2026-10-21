import json
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Bar
from app.store import Store
from app.study_jobs import AlertJob, DailyAlertTimer, expected_session
from tests.test_alerts import series, study

UNIVERSE = [{"symbol": "AAA", "name": "AAA", "sector": "X"}]


def job(tmp_path, n_after, with_study=True):
    store = Store(tmp_path / "a.sqlite3")
    store.initialize()
    if with_study:
        store.save_study(study())
    state = {"n": n_after}
    j = AlertJob(store, universe=UNIVERSE, daily=lambda s, f: series(n_after=state["n"], signal_at=25)[:26 + state["n"]])
    return store, j, state


def run(j):
    j.start()
    j.wait()
    return j.current_status()


def test_run_writes_alerts_once_per_session(tmp_path):
    store, j, _ = job(tmp_path, 0)
    assert run(j).error is None
    first = store.alerts_for(store.get_meta("last_alert_session"))
    assert len(first) == 1 and first[0]["concept"] == "stopping_volume"
    run(j)
    assert store.alerts_for(first[0]["session_date"]) == first
    assert json.loads(store.get_meta("last_alert_run"))["added"] == 0


def test_later_bars_score_open_alerts(tmp_path):
    store, j, state = job(tmp_path, 0)
    run(j)
    assert store.alerts_with_outcomes() == []
    state["n"] = 6
    run(j)
    assert sorted(r["horizon"] for r in store.alerts_with_outcomes()) == [1, 5]
    assert list(json.loads(store.get_meta("alert_index")).values()) == [25]


def test_no_study_no_alerts(tmp_path):
    store, j, _ = job(tmp_path, 0, with_study=False)
    status = run(j)
    assert "study" in status.error and store.get_meta("last_alert_session") is None


def test_endpoints_and_index(tmp_path):
    store, j, state = job(tmp_path, 0)
    run(j)
    state["n"] = 6
    run(j)
    app = create_app(tmp_path / "a.sqlite3", scan_universe=UNIVERSE)
    with TestClient(app, client=("127.0.0.1", 1), base_url="http://localhost") as c:
        body = c.get("/api/v1/alerts?date=" + store.alerts_with_outcomes()[0]["session_date"]).json()
        assert set(body) == {"session", "alerts", "last_run"} and len(body["alerts"]) == 1 and body["last_run"]["session"]
        assert c.get("/api/v1/alerts?date=2001-01-01").json()["alerts"] == []
        assert c.get("/api/v1/alerts?date=bad").status_code == 422
        tr = c.get("/api/v1/track-record").json()
        assert set(tr) == {"rows", "round_trip_cost", "min_cases"} and tr["rows"]
        assert {"concept", "horizon", "n", "hit_rate", "mean_return_net", "baseline_hit_rate", "verdict"} <= set(tr["rows"][0])
        assert tr["rows"][0]["baseline_hit_rate"] is not None
        assert c.get("/api/v1/alerts/status").json()["running"] is False


def test_lan_client_without_session_gets_401(tmp_path):
    app = create_app(tmp_path / "b.sqlite3", scan_universe=UNIVERSE)
    with TestClient(app, client=("192.168.1.50", 1), base_url="http://192.168.1.20:8000") as c:
        for method, path in (("get", "/api/v1/alerts"), ("get", "/api/v1/track-record"), ("get", "/api/v1/alerts/status"), ("post", "/api/v1/alerts/run")):
            assert getattr(c, method)(path, headers={"X-MSI-Request": "1"}).status_code == 401


def test_expected_session_and_timer_runs_once(tmp_path):
    assert expected_session(datetime(2026, 10, 21, 21, 0, tzinfo=UTC)) == "2026-10-21"  # Wed 17:00 NY
    assert expected_session(datetime(2026, 10, 21, 18, 0, tzinfo=UTC)) == "2026-10-20"  # Wed 14:00 NY
    assert expected_session(datetime(2026, 10, 24, 18, 0, tzinfo=UTC)) == "2026-10-23"  # Saturday
    store, j, _ = job(tmp_path, 0)
    timer = DailyAlertTimer(store, j)
    now = datetime(2026, 10, 21, 21, 0, tzinfo=UTC)
    # The fake bars never reach 2026-10-21 (like a holiday): retried, but only MAX_ATTEMPTS times.
    for _ in range(DailyAlertTimer.MAX_ATTEMPTS):
        assert timer.check(now) is True
        j.wait()
    assert timer.check(now) is False
    store.set_meta("last_alert_attempt", "{}")
    store.set_meta("last_alert_session", "2026-10-21")
    assert timer.check(now) is False  # already logged
    store.set_meta("last_alert_run", json.dumps({"session": "2026-10-21", "fetch_errors": 4}))
    assert timer.check(now) is True  # some symbols failed: retried
    j.wait()


def test_timer_does_not_use_an_attempt_while_a_job_runs(tmp_path):
    store, j, _ = job(tmp_path, 0)
    j.start = lambda: (j.current_status(), False)
    assert DailyAlertTimer(store, j).check(datetime(2026, 10, 21, 21, 0, tzinfo=UTC)) is False
    assert store.get_meta("last_alert_attempt") is None


def test_symbol_that_failed_gets_its_alert_on_rerun(tmp_path):
    store, j, _ = job(tmp_path, 0)
    good = j.daily
    j.daily = lambda s, f: (_ for _ in ()).throw(RuntimeError("rate limited"))
    run(j)
    assert store.alerts_with_outcomes() == [] and store.get_meta("last_alert_session") is None
    j.daily = good
    run(j)
    assert len(store.alerts_for(store.get_meta("last_alert_session"))) == 1


def test_missed_sessions_are_recorded(tmp_path):
    from app.study_jobs import weekdays_between
    assert weekdays_between("2026-10-19", "2026-10-23") == 3 and weekdays_between("2026-10-23", "2026-10-26") == 0
    store, j, _ = job(tmp_path, 0)
    store.set_meta("last_alert_session", "2000-01-03")
    run(j)
    last = json.loads(store.get_meta("last_alert_run"))
    assert last["previous_session"] == "2000-01-03" and last["skipped_sessions"] > 0
    run(j)
    assert json.loads(store.get_meta("last_alert_run"))["previous_session"] == "2000-01-03"


def test_alerts_endpoint_adds_study_figures_only_for_the_matching_study(tmp_path):
    from fastapi.testclient import TestClient
    from app.main import create_app
    app = create_app(tmp_path / "s.sqlite3")
    with TestClient(app, client=("127.0.0.1", 1), base_url="http://localhost") as c:
        store = app.state.store
        study = {"generated_at": "g1", "holds": [{"concept": "no_supply", "horizon": 5, "holds": True}],
                 "stats": [{"concept": "no_supply", "horizon": 5, "period": "newer", "edge": 0.02, "hit_rate": 0.6}]}
        store.save_study(study)
        store.save_alerts([{"symbol": "AAA", "session_date": "2026-01-02", "concept": "no_supply", "direction": "strength",
                            "entry_close": 10.0, "study_generated_at": "g1"}], "2026-01-02T22:00:00+00:00")
        a = c.get("/api/v1/alerts?date=2026-01-02").json()["alerts"][0]
        assert a["holding_horizons"] == [5] and a["study_newer"] == [{"horizon": 5, "edge": 0.02, "hit_rate": 0.6}]
        store.save_study({**study, "generated_at": "g2"})
        assert "study_newer" not in c.get("/api/v1/alerts?date=2026-01-02").json()["alerts"][0]
