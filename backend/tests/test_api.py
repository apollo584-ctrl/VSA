import json

from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Analysis, Dataset
from scripts.demo import demo_csv, demo_source
from tests.conftest import csv_bytes, make_bar


def upload(client, raw=None):
    return client.post("/api/v1/datasets/upload", files={"file": ("demo.csv", raw or demo_csv(), "text/csv")},
                       data={"metadata": demo_source().model_dump_json()})


def test_vertical_slice_and_restart_persistence(tmp_path):
    path = tmp_path / "persistent.sqlite3"
    with TestClient(create_app(path)) as client:
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
    with TestClient(create_app(path)) as client:
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
