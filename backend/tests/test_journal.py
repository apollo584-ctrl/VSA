import csv
import io

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

BODY = {"trade_date": "2025-03-11", "symbol": "aapl", "kind": "taken", "entry": 100.5, "stop": 100.0, "target": 101.5,
        "shares": 100, "planned_loss": 50, "net_pnl": 95, "exit_reason": "target", "notes": "=SUM(A1)"}


def post(client, **over):
    return client.post("/api/v1/journal", json={**BODY, **over})


def test_create_returns_201_with_server_fields(client):
    r = post(client)
    assert r.status_code == 201
    row = r.json()
    assert row["id"] == 1 and row["symbol"] == "AAPL" and row["setup_version"] == "A-1.0" and row["rule_breach"] is False
    assert row["r_multiple"] == pytest.approx(1.9) and row["created_at"] == row["updated_at"]
    assert row["fees"] is None and row["exit_time"] is None


def test_r_multiple_needs_positive_planned_loss(client):
    assert post(client, planned_loss=0).json()["r_multiple"] is None
    assert post(client, planned_loss=None).json()["r_multiple"] is None
    assert post(client, net_pnl=None).json()["r_multiple"] is None
    assert post(client, net_pnl=-50).json()["r_multiple"] == -1.0


def test_client_cannot_set_server_fields_and_bad_input_is_422(client):
    assert post(client, r_multiple=5).status_code == 422
    assert post(client, id=9).status_code == 422
    assert post(client, kind="maybe").status_code == 422
    assert post(client, trade_date="2025-13-40").status_code == 422
    assert post(client, exit_reason="because").status_code == 422
    assert post(client, shares=-1).status_code == 422


def test_update_recomputes_r_and_keeps_created_at(client):
    first = post(client).json()
    r = client.put(f"/api/v1/journal/{first['id']}", json={**BODY, "net_pnl": -25, "rule_breach": True})
    assert r.status_code == 200
    row = r.json()
    assert row["r_multiple"] == -0.5 and row["rule_breach"] is True and row["created_at"] == first["created_at"]
    assert row["updated_at"] >= first["updated_at"]


def test_update_missing_is_404_and_there_is_no_delete(client):
    assert client.put("/api/v1/journal/99", json=BODY).status_code == 404
    assert client.delete("/api/v1/journal/1").status_code == 405


def test_list_newest_first_and_date_filter(client):
    post(client, symbol="AAA")
    post(client, symbol="BBB", trade_date="2025-03-12")
    post(client, symbol="CCC")
    assert [r["symbol"] for r in client.get("/api/v1/journal").json()] == ["CCC", "BBB", "AAA"]
    assert [r["symbol"] for r in client.get("/api/v1/journal", params={"date": "2025-03-11"}).json()] == ["CCC", "AAA"]
    assert client.get("/api/v1/journal", params={"date": "bad"}).status_code == 422


def test_day_summary_counts_only_taken_trades(client):
    post(client, net_pnl=95)
    post(client, net_pnl=-30)
    post(client, net_pnl=-10)
    post(client, kind="skipped", net_pnl=None, skip_reason="too far")
    post(client, trade_date="2025-03-12", net_pnl=-500)
    assert client.get("/api/v1/journal/day-summary", params={"date": "2025-03-11"}).json() == {
        "date": "2025-03-11", "trades": 3, "losses": 2, "realized_pnl": 55.0}
    assert client.get("/api/v1/journal/day-summary", params={"date": "2025-03-20"}).json() == {
        "date": "2025-03-20", "trades": 0, "losses": 0, "realized_pnl": 0}
    assert client.get("/api/v1/journal/day-summary").status_code == 422


def test_csv_export_has_header_rows_and_neutralises_formulas(client):
    post(client)
    r = client.get("/api/v1/journal/export.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert len(rows) == 1 and rows[0]["symbol"] == "AAPL" and rows[0]["r_multiple"] == "1.9"
    assert rows[0]["notes"] == "'=SUM(A1)" and rows[0]["fees"] == "" and rows[0]["rule_breach"] == "false"
    assert list(rows[0])[:3] == ["id", "created_at", "updated_at"]


def test_entries_survive_restart(tmp_path):
    path = tmp_path / "j.sqlite3"
    with TestClient(create_app(path), client=("127.0.0.1", 50000), base_url="http://localhost") as c:
        post(c)
    with TestClient(create_app(path), client=("127.0.0.1", 50000), base_url="http://localhost") as c:
        assert len(c.get("/api/v1/journal").json()) == 1
