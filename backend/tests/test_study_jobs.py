import json
import re
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.store import Store
from app.study_jobs import is_stale
from tests.test_symbol_load import chart

UNIVERSE = [{"symbol": s, "name": s, "sector": "X"} for s in ("AAA", "BBB", "CCC")]


def daily_payload(symbol, n=120):
    day0 = datetime(2024, 1, 2, 15, tzinfo=UTC)
    stamps = [int((day0 + timedelta(days=i)).timestamp()) for i in range(n)]
    close = [100 + (i % 7) + i * .05 for i in range(n)]
    quote = {"open": close, "high": [c + 1 for c in close], "low": [c - 1 for c in close], "close": close, "volume": [1000 + (i * 37) % 900 for i in range(n)]}
    return {"chart": {"result": [{"meta": {"symbol": symbol}, "timestamp": stamps, "indicators": {"quote": [quote]}}], "error": None}}


def fetch_for(failing=()):
    def fetch(url):
        symbol = re.search(r"/chart/([^?]+)", url).group(1)
        if symbol in failing:
            raise ValueError("boom")
        return json.dumps(daily_payload(symbol) if "interval=1d" in url else chart(symbol=symbol)).encode()
    return fetch


@pytest.fixture
def make(tmp_path):
    made = []

    def build(fetch, name="j.sqlite3"):
        client = TestClient(create_app(tmp_path / name, market_fetch=fetch, scan_universe=UNIVERSE))
        client.__enter__()
        made.append(client)
        return client
    yield build
    for c in made:
        c.__exit__(None, None, None)


def test_study_runs_to_completion_and_is_saved(make):
    client = make(fetch_for())
    assert client.get("/api/v1/outcomes").json()["study"] is None
    assert client.post("/api/v1/outcomes/run").status_code == 202
    client.app.state.study_runner.wait(30)
    body = client.get("/api/v1/outcomes").json()
    assert body["status"]["running"] is False and body["status"]["done"] == 3 and body["status"]["errors"] == 0
    assert body["study"]["symbols_used"] == ["AAA", "BBB", "CCC"]
    assert body["study"] == client.app.state.store.latest_study()


def test_study_counts_failures_and_double_start_is_rejected(make):
    client = make(fetch_for(failing=("BBB",)))
    first = client.post("/api/v1/outcomes/run")
    second = client.post("/api/v1/outcomes/run")
    assert first.status_code == 202 and second.status_code in (200, 202)
    if second.status_code == 200:
        assert second.json()["running"] is True
    client.app.state.study_runner.wait(30)
    status = client.get("/api/v1/outcomes").json()
    assert status["status"]["errors"] == 1 and status["status"]["done"] == 3
    assert status["study"]["symbols_used"] == ["AAA", "CCC"]


def test_double_start_returns_200_while_running(tmp_path):
    from app.study_jobs import StudyRunner
    import threading
    gate = threading.Event()
    runner = StudyRunner(Store(tmp_path / "g.sqlite3"), universe=UNIVERSE[:1], daily=lambda s, f: gate.wait(10) and [])
    _, started = runner.start()
    _, again = runner.start()
    gate.set()
    runner.shutdown()
    assert started is True and again is False


def test_intraday_collect_is_idempotent(make):
    client = make(fetch_for(failing=("CCC",)))
    assert client.post("/api/v1/intraday/collect").status_code == 202
    client.app.state.collector.wait(30)
    first = client.get("/api/v1/intraday").json()
    assert first["status"]["bars_added"] > 0 and first["status"]["errors"] == 1
    assert first["summary"]["symbols"] == 2 and first["summary"]["bars"] == first["status"]["bars_added"]
    assert first["summary"]["last_collected_at"]
    client.post("/api/v1/intraday/collect")
    client.app.state.collector.wait(30)
    second = client.get("/api/v1/intraday").json()
    assert second["status"]["bars_added"] == 0 and second["summary"]["bars"] == first["summary"]["bars"]


def test_stale_check():
    now = datetime(2026, 10, 20, tzinfo=UTC)
    assert is_stale(None, now) and is_stale("garbage", now)
    assert is_stale((now - timedelta(days=4)).isoformat(), now)
    assert not is_stale((now - timedelta(days=2)).isoformat(), now)


def test_auto_collect_only_when_enabled_and_stale(tmp_path, monkeypatch):
    def started(env, db):
        if env:
            monkeypatch.setenv("MSI_AUTO_COLLECT", "1")
        else:
            monkeypatch.delenv("MSI_AUTO_COLLECT", raising=False)
        with TestClient(create_app(tmp_path / db, market_fetch=fetch_for(), scan_universe=UNIVERSE)) as c:
            c.app.state.collector.wait(30)
            return c.app.state.collector.current_status().started_at is not None
    assert started(False, "a.sqlite3") is False
    assert started(True, "b.sqlite3") is True
    assert started(True, "b.sqlite3") is False


def test_old_database_without_new_tables_initializes(tmp_path):
    path = tmp_path / "old.sqlite3"
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE scan_results (symbol TEXT PRIMARY KEY, scanned_at TEXT NOT NULL, payload TEXT NOT NULL)")
    db.commit()
    db.close()
    store = Store(path)
    store.initialize()
    assert store.latest_study() is None and store.get_meta("x") is None
    assert store.intraday_summary()["bars"] == 0


def _bars(closes):
    from app.models import Bar
    t0 = datetime(2026, 10, 1, 14, tzinfo=UTC)
    return [Bar(timestamp=t0 + timedelta(minutes=30 * i), available_at=t0 + timedelta(minutes=30 * i + 30), session="regular",
                open=c, high=c, low=c, close=c, volume=1) for i, c in enumerate(closes)]


def test_split_rebases_and_unchanged_refetch_adds_nothing(tmp_path):
    store = Store(tmp_path / "s.sqlite3")
    store.initialize()
    assert store.save_intraday_bars("AAA", _bars([100, 101, 102])) == 3
    assert store.save_intraday_bars("AAA", _bars([100, 101, 102])) == 0
    assert store.save_intraday_bars("AAA", _bars([100.05, 101, 102, 103])) == 1
    assert store.intraday_summary()["rebased_symbols"] == 0
    assert store.save_intraday_bars("AAA", _bars([50, 50.5, 51, 51.5])) == 4
    summary = store.intraday_summary()
    assert summary["rebased_symbols"] == 1 and summary["bars"] == 4 and summary["symbols"] == 1
    with store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM intraday_bars").fetchone()[0] == 8


def test_collector_does_not_mark_collected_when_all_symbols_fail(make):
    client = make(fetch_for(failing=("AAA", "BBB", "CCC")))
    client.post("/api/v1/intraday/collect")
    client.app.state.collector.wait(30)
    body = client.get("/api/v1/intraday").json()
    assert body["status"]["errors"] == 3 and body["summary"]["last_collected_at"] is None


def test_finalize_failure_is_reported_in_status(make, monkeypatch):
    client = make(fetch_for())

    def boom(study):
        raise sqlite3.OperationalError("disk full")
    monkeypatch.setattr(client.app.state.store, "save_study", boom)
    client.post("/api/v1/outcomes/run")
    client.app.state.study_runner.wait(30)
    status = client.get("/api/v1/outcomes").json()["status"]
    assert status["running"] is False and "disk full" in status["error"]
