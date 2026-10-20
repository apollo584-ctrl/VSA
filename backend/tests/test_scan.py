"""Confluence scanner: flags only aligned readings, isolates per-symbol failures, persists results, never stores datasets."""
import json
import re

import pytest
from fastapi.testclient import TestClient

from app.data import ingest
from app.interpretation import interpret
from app.main import create_app
from app.models import AnalyzeRequest, Evidence, ValueLocation
from app.scan import MIN_AGREEING, confluence, load_universe
from scripts.demo import demo_csv, demo_source
from tests.test_symbol_load import chart

UNIVERSE = [{"symbol": s, "name": s + " Inc", "sector": "Tech"} for s in ("AAA", "BBB", "CCC")]


def base_analysis():
    dataset, bars = ingest(demo_csv(), demo_source())
    a = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, persist=False))
    a.vsa_observations, a.price_action_observations = [], []
    a.auction_state.transitions = []
    return a, bars


def ev(direction, status="provisional", concept="no_demand", when=None, bars=None):
    stamp = (when or bars[-1].timestamp)
    return Evidence(id=f"{concept}:{direction}:{status}", kind="classified", concept_id=concept, timestamp=stamp, first_observable_at=stamp,
                    status=status, direction=direction, description="x")


def with_state(a, location, auction):
    a.value_location = ValueLocation(state=location, price=101, as_of=a.analysis_timestamp, reference_session="2025-03-07", val=99, vah=100, poc=99.5) if location != "unavailable" else \
        ValueLocation(state="unavailable", price=101, as_of=a.analysis_timestamp, unavailable_reason="no_prior_session")
    a.auction_state.state = auction


def test_universe_is_the_sp500_list_with_yahoo_symbols():
    universe = load_universe()
    assert 495 <= len(universe) <= 510 and len({c["symbol"] for c in universe}) == len(universe)
    symbols = {c["symbol"] for c in universe}
    assert {"AAPL", "MSFT", "BRK-B"} <= symbols and "BRK.B" not in symbols


def test_three_agreeing_readings_flag_strength():
    a, bars = base_analysis()
    with_state(a, "above_value", "higher_price_acceptance")
    a.vsa_observations = [ev("strength", bars=bars)]
    direction, agreeing, votes = confluence(a)
    assert (direction, agreeing) == ("strength", 3) and MIN_AGREEING == 3
    assert {v.factor for v in votes} == {"value_location", "auction_state", "vsa"}


def test_three_agreeing_readings_flag_weakness():
    a, bars = base_analysis()
    with_state(a, "below_value", "rejection_above_value")
    a.price_action_observations = [ev("weakness", status="observed", concept="breakout", bars=bars)]
    assert confluence(a)[:2] == ("weakness", 3)


def test_any_opposing_reading_or_too_few_readings_does_not_flag():
    a, bars = base_analysis()
    with_state(a, "above_value", "higher_price_acceptance")
    a.vsa_observations = [ev("strength", bars=bars)]
    a.price_action_observations = [ev("weakness", status="observed", concept="breakout", bars=bars)]
    assert confluence(a)[0] == "none"
    a.price_action_observations = []
    a.vsa_observations = []
    assert confluence(a)[:2] == ("none", 2)
    with_state(a, "unavailable", "indeterminate")
    assert confluence(a) == ("none", 0, [])


def test_engine_reported_contradiction_suppresses_the_flag():
    # Reproduces the review case: strength majority, an opposing weakness observation, and populated contradicting_evidence.
    a, bars = base_analysis()
    with_state(a, "above_value", "higher_price_acceptance")
    a.vsa_observations = [ev("strength", bars=bars), ev("strength", concept="stopping_volume", bars=bars), ev("weakness", concept="upthrust", bars=bars)]
    assert confluence(a)[:2] == ("strength", 3)  # majority voting alone would flag it
    a.contradicting_evidence = [a.vsa_observations[2].id]
    assert confluence(a)[0] == "none"


def test_resolved_vsa_and_earlier_session_signals_do_not_count():
    a, bars = base_analysis()
    with_state(a, "above_value", "higher_price_acceptance")
    a.vsa_observations = [ev("strength", status="invalidated", bars=bars)]
    assert confluence(a)[0] == "none"
    session_start = a.auction_state.session_resets[-1].timestamp
    a.vsa_observations = [ev("strength", when=session_start - (bars[1].timestamp - bars[0].timestamp), bars=bars)]
    assert confluence(a)[0] == "none"


def fetch_for(failing=()):
    def fetch(url):
        symbol = re.search(r"/chart/([^?]+)", url).group(1)
        if symbol in failing:
            raise ValueError("boom")
        return json.dumps(chart(symbol=symbol)).encode()
    return fetch


def wait_done(client):
    client.app.state.scanner.wait(30)
    return client.get("/api/v1/scan").json()


@pytest.fixture
def make(tmp_path):
    made = []

    def build(fetch, name="s.sqlite3"):
        client = TestClient(create_app(tmp_path / name, market_fetch=fetch, scan_universe=UNIVERSE), client=("127.0.0.1", 50000), base_url="http://localhost")
        client.__enter__()
        made.append(client)
        return client
    yield build
    for c in made:
        c.__exit__(None, None, None)


def test_scan_runs_in_background_saves_results_and_stores_no_datasets(make):
    client = make(fetch_for())
    started = client.post("/api/v1/scan/run")
    assert started.status_code == 202 and started.json()["total"] == 3
    body = wait_done(client)
    assert body["status"]["running"] is False and body["status"]["done"] == 3 and body["status"]["finished_at"]
    assert sorted(r["symbol"] for r in body["results"]) == ["AAA", "BBB", "CCC"]
    assert all(r["status"] == "ok" and r["last_close"] and r["last_bar_at"] and r["direction"] in ("strength", "weakness", "none") for r in body["results"])
    assert client.get("/api/v1/instruments").json()["items"] == []


def test_one_failing_symbol_is_recorded_and_does_not_stop_the_scan(make):
    client = make(fetch_for(failing={"BBB"}))
    client.post("/api/v1/scan/run")
    body = wait_done(client)
    by = {r["symbol"]: r for r in body["results"]}
    assert by["BBB"]["status"] == "error" and by["BBB"]["error"] and by["BBB"]["direction"] == "none"
    assert by["AAA"]["status"] == "ok" and by["CCC"]["status"] == "ok"
    assert body["results"][-1]["symbol"] == "BBB"  # errors sort last


def test_subset_scan_and_persistence_across_restart(make, tmp_path):
    client = make(fetch_for())
    assert client.post("/api/v1/scan/run", json={"symbols": ["aaa", "zzz"]}).json()["total"] == 1
    wait_done(client)
    again = make(fetch_for(), name="s.sqlite3")  # same database file
    assert [r["symbol"] for r in again.get("/api/v1/scan").json()["results"]] == ["AAA"]
    assert again.get("/api/v1/scan").json()["status"]["running"] is False


def test_auto_scan_setting_is_validated_and_reported(make):
    client = make(fetch_for())
    assert client.post("/api/v1/scan/auto", json={"minutes": 7}).status_code == 422
    assert client.post("/api/v1/scan/auto", json={"minutes": 30}).json()["auto_minutes"] == 30
    client.app.state.scanner.wait(30)
    assert client.post("/api/v1/scan/auto", json={"minutes": 0}).json()["auto_minutes"] == 0
