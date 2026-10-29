import json
from datetime import datetime
import pytest

from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Analysis, Dataset, Parameters
from scripts.demo import demo_csv, demo_source
from tests.conftest import csv_bytes, make_bar


def upload(client, raw=None):
    return client.post("/api/v1/datasets/upload", files={"file": ("demo.csv", raw or demo_csv(), "text/csv")},
                       data={"metadata": demo_source().model_dump_json()})


def test_vertical_slice_and_restart_persistence(tmp_path):
    path = tmp_path / "persistent.sqlite3"
    with TestClient(create_app(path), client=("127.0.0.1", 50000), base_url="http://localhost") as client:
        response = upload(client)
        assert response.status_code == 201, response.text
        dataset = Dataset.model_validate(response.json())
        assert dataset.source.is_demo and dataset.row_count == 468
        assert client.get(f"/api/v1/datasets/{dataset.id}").json() == response.json()
        bars = client.get("/api/v1/market/bars", params={"dataset_id": dataset.id, "offset": 1, "limit": 2}).json()
        assert len(bars) == 2 and bars[0]["timestamp"] < bars[1]["timestamp"]
        profiles = client.get("/api/v1/profiles", params={"dataset_id": dataset.id}).json()
        assert len(profiles) == 6
        assert profiles[0]["volume"]["estimated"]
        assert client.get("/api/v1/profiles", params={"dataset_id": dataset.id, "composite": True}).json()[0]["scope"] == "composite"
        result = client.post("/api/v1/analyze", json={"dataset_id": dataset.id})
        assert result.status_code == 201, result.text
        analysis = Analysis.model_validate(result.json())
        assert analysis.plain_english_summary and analysis.vsa_observations
        assert result.headers["X-Request-ID"]
        saved = result.json()
    with TestClient(create_app(path), client=("127.0.0.1", 50000), base_url="http://localhost") as client:
        assert client.get(f"/api/v1/analyses/{analysis.id}").json() == saved
        assert client.get("/api/v1/instruments").json()["items"][0]["dataset_ids"] == [dataset.id]
    # Windows forbids this if a SQLite connection was left open.
    path.unlink()
    assert not path.exists()


def test_errors_do_not_insert_and_asof_rejects_early_or_naive(client):
    response = upload(client, b"bad,data\n")
    assert response.status_code == 422
    assert client.get("/api/v1/instruments").json() == {"items": []}
    assert client.get("/api/v1/datasets/nope").status_code == 404
    assert client.get("/api/v1/analyses/nope").status_code == 404
    assert client.post("/api/v1/analyze", json={"dataset_id": "nope"}).status_code == 404
    dataset = upload(client).json()
    for stamp in ["2025-03-03T09:30:00", "2025-03-03T13:00:00Z"]:
        assert client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "as_of": stamp}).status_code == 422
    result = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "as_of": "2025-03-03T14:35:00Z"})
    assert result.status_code == 201
    assert len(result.json()["profile_analysis"]) == 1
    assert result.json()["analysis_timestamp"] == "2025-03-03T14:35:00Z"
    assert client.get("/api/v1/profiles", params={"dataset_id": dataset["id"], "bin_size": .000001}).status_code == 422


def test_knowledge_openapi_and_cors(client):
    knowledge = client.get("/api/v1/knowledge/concepts").json()
    assert len(knowledge) == 34
    assert len([c for c in knowledge if c["category"] in ("strength", "weakness", "neutral")]) == 26
    assert client.get("/api/v1/knowledge/concepts/spring").json()["detector_status"] == "implemented"
    assert client.get("/api/v1/knowledge/concepts/shakeout").json()["detector_status"] == "knowledge_only"
    assert client.get("/api/v1/knowledge/concepts/spring/related").json()[0]["id"] == "volume_expansion"
    assert client.get("/api/v1/knowledge/concepts/missing").status_code == 404
    assert "/api/v1/analyze" in client.get("/openapi.json").json()["paths"]
    response = client.options("/api/v1/analyze", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert client.get("/api/v1/health").json()["live_data"] is False


def test_split_blocks_analysis_and_profile_but_keeps_source(client):
    response = upload(client, csv_bytes([make_bar(0), make_bar(1, o=50, h=51, low=49, c=50)]))
    assert response.status_code == 201
    dataset = response.json()
    assert dataset["quality"]["split_suspected"]
    assert client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).status_code == 422
    assert client.get("/api/v1/profiles", params={"dataset_id": dataset["id"]}).status_code == 422
    assert len(client.get("/api/v1/market/bars", params={"dataset_id": dataset["id"]}).json()) == 2


def test_snapshot_preserves_knowledge_across_catalog_updates(client, monkeypatch):
    from app.knowledge import load
    dataset = upload(client).json()
    original = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    assert original["knowledge_snapshot"]["version"] == original["knowledge_version"]
    changed = load().model_copy(deep=True)
    changed.version = "2.0.0"
    for concept in changed.concepts:
        concept.possible_interpretations = ["New catalog explanation"]
    monkeypatch.setattr("app.interpretation.load", lambda: changed)
    monkeypatch.setattr("app.main.load", lambda: changed)
    assert client.get(f'/api/v1/analyses/{original["id"]}').json() == original
    updated = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    assert updated["knowledge_snapshot"]["version"] == "2.0.0"
    assert original["knowledge_snapshot"] != updated["knowledge_snapshot"]
    legacy = Analysis.model_validate({k: v for k, v in original.items() if k != "knowledge_snapshot"}).model_copy(update={"id": "legacy-snapshot"})
    client.app.state.store.save_analysis(legacy)
    assert client.get("/api/v1/analyses/legacy-snapshot").json()["knowledge_snapshot"] is None


def test_extended_hourly_analysis_with_compatible_tpo(client):
    metadata = demo_source().model_dump() | {"timeframe_minutes": 60, "session_mode": "extended"}
    raw = b"timestamp,open,high,low,close,volume\n2025-03-10T04:00:00-04:00,100,101,99,100,1000\n"
    response = client.post("/api/v1/datasets/upload", files={"file": ("hourly.csv", raw)}, data={"metadata": json.dumps(metadata)})
    assert response.status_code == 201
    result = client.post("/api/v1/analyze", json={"dataset_id": response.json()["id"], "parameters": {"tpo_minutes": 60}})
    assert result.status_code == 201, result.text
    assert result.json()["timeframe"] == "60m"


def test_previews_write_nothing_and_cannot_be_stored(client, monkeypatch):
    dataset = upload(client).json()
    saved = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    assert saved["persisted"] is True and saved["id"] is not None
    store = client.app.state.store
    with store.connect() as db:
        before = db.execute("SELECT id, snapshot FROM analyses ORDER BY id").fetchall()
        dataset_count = db.execute("SELECT COUNT(*) FROM datasets").fetchone()[0]
    original_save = store.save_analysis
    monkeypatch.setattr(store, "save_analysis", lambda *_: pytest.fail("Preview attempted a database write"))
    for cutoff in ["2025-03-03T14:35:00Z", "2025-03-05T18:15:00Z", None]:
        response = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "as_of": cutoff, "persist": False})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert preview["persisted"] is False and preview["id"] is None
        assert preview["composite_profile"] is not None
        if cutoff is None:
            metadata = {"id", "persisted", "created_at"}
            assert {k: v for k, v in preview.items() if k not in metadata} == {k: v for k, v in saved.items() if k not in metadata}
        with pytest.raises(ValueError, match="preview"):
            original_save(Analysis.model_validate(preview))
    with store.connect() as db:
        assert db.execute("SELECT id, snapshot FROM analyses ORDER BY id").fetchall() == before
        assert db.execute("SELECT COUNT(*) FROM datasets").fetchone()[0] == dataset_count
    assert client.get(f'/api/v1/analyses/{saved["id"]}').json() == saved


def test_composite_uses_analysis_cutoff_and_all_parameters(client):
    from app.profiles import profile
    dataset = upload(client).json()
    parameters = {"bin_size": 0.5, "value_area_fraction": 0.8, "tpo_minutes": 60}
    cutoff = "2025-03-05T18:15:00Z"
    response = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "as_of": cutoff, "parameters": parameters})
    assert response.status_code == 201
    result = response.json()
    d, bars = client.app.state.store.dataset(dataset["id"])
    visible = [bar for bar in bars if bar.available_at <= datetime.fromisoformat(cutoff)]
    expected = profile(visible, d.source, Parameters(**parameters), "composite").model_dump(mode="json")
    assert result["composite_profile"] == expected
    assert result["composite_profile"]["as_of"] == cutoff
    assert result["composite_unavailable_reason"] is None
    assert sum(result["composite_profile"]["volume"]["counts"]) == pytest.approx(sum(bar.volume for bar in visible))
    assert client.get(f'/api/v1/analyses/{result["id"]}').json() == result


def test_legacy_snapshot_is_not_recomputed_or_rewritten(client):
    dataset = upload(client).json()
    result = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    legacy = {k: v for k, v in result.items() if k not in {"persisted", "composite_profile", "composite_unavailable_reason"}}
    legacy["id"] = "legacy-composite"
    encoded = json.dumps(legacy)
    with client.app.state.store.connect() as db:
        db.execute("INSERT INTO analyses VALUES (?, ?, ?)", (legacy["id"], dataset["id"], encoded))
    reopened = client.get("/api/v1/analyses/legacy-composite").json()
    assert reopened["persisted"] is True
    assert reopened["composite_profile"] is None
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT snapshot FROM analyses WHERE id=?", (legacy["id"],)).fetchone()[0] == encoded


def test_composite_resource_limit_does_not_block_session_analysis(client):
    raw = csv_bytes([make_bar(0, o=100, h=100.1, low=99.9, c=100),
                     make_bar(0, session="2025-03-11", o=104, h=104.1, low=103.9, c=104)])
    dataset = upload(client, raw).json()
    result = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "parameters": {"bin_size": 0.001}})
    assert result.status_code == 201, result.text
    snapshot = result.json()
    assert len(snapshot["profile_analysis"]) == 2
    assert snapshot["composite_profile"] is None
    assert "2000 bins" in snapshot["composite_unavailable_reason"]
    assert any("Composite profile unavailable" in text for text in snapshot["uncertainties"])


def test_failed_preview_creates_no_analysis(client):
    dataset = upload(client).json()
    result = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "as_of": "2025-03-03T13:00:00Z", "persist": False})
    assert result.status_code == 422
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM analyses").fetchone()[0] == 0


def test_saved_and_preview_evidence_has_complete_receipts(client):
    dataset = upload(client).json()
    saved = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    evidence = saved["vsa_observations"] + saved["price_action_observations"] + saved["auction_state"]["transitions"]
    assert evidence
    for item in evidence:
        assert item["conditions_met"] and all(c["met"] for c in item["conditions_met"])
        assert item["status_history"][-1]["status"] == item["status"]
        assert item["status_history"][0]["at"] == item["first_observable_at"]
        if item["status"] in {"confirmed", "invalidated", "expired"}:
            assert item["resolved_at"] == item[f'{item["status"]}_at'] == item["status_history"][-1]["at"]
    assert client.get(f'/api/v1/analyses/{saved["id"]}').json() == saved
    preview = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "persist": False}).json()
    assert preview["vsa_observations"] == saved["vsa_observations"]
    assert preview["price_action_observations"] == saved["price_action_observations"]


def test_setup_a_endpoint_validates_symbols_and_isolates_failures(tmp_path):
    from app.providers import ProviderUnavailable

    def down(url):
        raise ProviderUnavailable("down")

    with TestClient(create_app(tmp_path / "s.sqlite3", market_fetch=down), client=("127.0.0.1", 50000), base_url="http://localhost") as c:
        for bad in ("", "AAPL,", "bad symbol", ",".join(f"S{i}" for i in range(9))):
            assert c.get("/api/v1/setup-a", params={"symbols": bad}).status_code == 422
        assert c.get("/api/v1/setup-a").status_code == 422
        body = c.get("/api/v1/setup-a", params={"symbols": "aapl,MSFT"}).json()
        assert [s["symbol"] for s in body["symbols"]] == ["AAPL", "MSFT"] and {s["stage"] for s in body["symbols"]} == {"no_data"}
        assert body["as_of"]
        preflight = c.options("/api/v1/journal/1", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "PUT"})
        assert preflight.status_code == 200


def _contract_chart(contract="ZCZ26", days=("2026-10-13", "2026-10-14"), minutes=30):
    import pandas as pd

    stamps = []
    for day in days:
        d = pd.Timestamp(day, tz="America/Chicago")
        for start, end in ((d - pd.Timedelta(hours=5), d + pd.Timedelta(hours=7, minutes=45)),
                           (d + pd.Timedelta(hours=8, minutes=30), d + pd.Timedelta(hours=13, minutes=20))):
            t = start
            while t < end:
                stamps.append(t)
                t += pd.Timedelta(minutes=minutes)
    n = len(stamps)
    base = [450 + (i % 8) * .25 for i in range(n)]
    quote = {"open": base, "high": [b + .5 for b in base], "low": [b - .25 for b in base],
             "close": [b + .25 for b in base], "volume": [100 + i for i in range(n)]}
    meta = {"symbol": f"{contract}.CBT", "exchangeName": "CBT", "instrumentType": "FUTURE"}
    return {"chart": {"result": [{"meta": meta, "timestamp": [int(s.timestamp()) for s in stamps],
                                  "indicators": {"quote": [quote]}}], "error": None}}


def _contract_client(tmp_path, fetch):
    return TestClient(create_app(tmp_path / "c.sqlite3", market_fetch=fetch), client=("127.0.0.1", 50000), base_url="http://localhost")


def test_from_contract_loads_grade_b_dataset_without_network(tmp_path):
    calls = []

    def fetch(url):
        calls.append(url)
        return json.dumps(_contract_chart()).encode()

    with _contract_client(tmp_path, fetch) as c:
        first = c.post("/api/v1/datasets/from-contract", json={"contract": " zcz26 "})
        assert first.status_code == 201, first.text
        dataset = first.json()
        assert dataset["source"]["market"] == "cbot_grains" and dataset["source"]["contract"] == "ZCZ26"
        assert dataset["source"]["timeframe_minutes"] == 30 and dataset["data_grade"] == "B"
        assert calls == ["https://query1.finance.yahoo.com/v8/finance/chart/ZCZ26.CBT?interval=30m&range=60d&includePrePost=false"]
        profiles = c.get("/api/v1/profiles", params={"dataset_id": dataset["id"]})
        assert profiles.status_code == 200, profiles.text
        again = c.post("/api/v1/datasets/from-contract", json={"contract": "ZCZ26"})
        assert again.status_code == 200 and again.json()["id"] == dataset["id"]


def test_from_contract_five_minute_bars(tmp_path):
    with _contract_client(tmp_path, lambda url: json.dumps(_contract_chart(minutes=5)).encode()) as c:
        response = c.post("/api/v1/datasets/from-contract", json={"contract": "ZCZ26", "timeframe_minutes": 5, "period": "5d"})
        assert response.status_code == 201, response.text
        assert response.json()["source"]["timeframe_minutes"] == 5


@pytest.mark.parametrize("body", [{"contract": "ZCX26"}, {"contract": "AAPL"}, {"contract": ""},
                                  {"contract": "ZCZ26", "timeframe_minutes": 60}, {"contract": "ZCZ26", "period": "10y"}])
def test_from_contract_rejects_invalid_requests_without_fetching(tmp_path, body):
    def fetch(url):
        raise AssertionError("no network call expected")

    with _contract_client(tmp_path, fetch) as c:
        assert c.post("/api/v1/datasets/from-contract", json=body).status_code == 422


def test_from_contract_upstream_failures(tmp_path):
    from app.providers import ProviderUnavailable

    def down(url):
        raise ProviderUnavailable("Market data provider could not be reached")

    with _contract_client(tmp_path, down) as c:
        assert c.post("/api/v1/datasets/from-contract", json={"contract": "ZCZ26"}).status_code == 502
        assert c.get("/api/v1/instruments").json()["items"] == []
    missing = {"chart": {"result": None, "error": {"code": "Not Found", "description": "No data found"}}}
    with _contract_client(tmp_path, lambda url: json.dumps(missing).encode()) as c:
        response = c.post("/api/v1/datasets/from-contract", json={"contract": "ZCZ26"})
        assert response.status_code == 422 and "ZCZ26.CBT" in response.json()["detail"]
