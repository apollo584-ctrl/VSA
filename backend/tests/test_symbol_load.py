"""Load-by-symbol: a stubbed Yahoo chart response goes through the same validation as an uploaded CSV."""
import json
from datetime import UTC, datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers import ProviderUnavailable, SymbolNotFound, YahooChartProvider

DAYS = ["2025-03-03", "2025-03-04", "2025-03-05"]


def chart(days=DAYS, extra_close_bar=True, null_at=None, symbol="SPY"):
    """Yahoo-shaped payload: 13 regular 30m bars per day, plus the 16:00 print Yahoo appends."""
    stamps = []
    for day in days:
        open_ = pd.Timestamp(day + " 09:30", tz="America/New_York")
        stamps += [open_ + pd.Timedelta(minutes=30 * i) for i in range(14 if extra_close_bar else 13)]
    seconds = [int(s.timestamp()) for s in stamps]
    n = len(seconds)
    quote = {"open": [100 + i * .01 for i in range(n)], "high": [100.5 + i * .01 for i in range(n)],
             "low": [99.5 + i * .01 for i in range(n)], "close": [100.2 + i * .01 for i in range(n)], "volume": [1000 + i for i in range(n)]}
    if null_at is not None:
        for column in quote.values():
            column[null_at] = None
    return {"chart": {"result": [{"meta": {"symbol": symbol, "exchangeName": "PCX", "exchangeTimezoneName": "America/New_York", "instrumentType": "ETF"}, "timestamp": seconds, "indicators": {"quote": [quote]}}], "error": None}}


def fetcher(payload, calls=None):
    def fetch(url):
        if calls is not None:
            calls.append(url)
        return json.dumps(payload).encode()
    return fetch


@pytest.fixture
def make_client(tmp_path):
    clients = []

    def make(fetch):
        client = TestClient(create_app(tmp_path / f"s{len(clients)}.sqlite3", market_fetch=fetch), client=("127.0.0.1", 50000), base_url="http://localhost")
        client.__enter__()
        clients.append(client)
        return client
    yield make
    for client in clients:
        client.__exit__(None, None, None)


def test_symbol_load_creates_a_dataset_that_analyses_like_an_upload(make_client):
    calls = []
    client = make_client(fetcher(chart(), calls))
    response = client.post("/api/v1/datasets/from-symbol", json={"symbol": " spy "})
    assert response.status_code == 201, response.text
    dataset = response.json()
    assert dataset["source"]["instrument"] == "SPY" and dataset["source"]["timeframe_minutes"] == 30
    assert dataset["source"]["source_name"] == "yahoo_finance_chart_1mo" and dataset["source"]["is_demo"] is False
    assert dataset["row_count"] == 39  # the 16:00 prints are dropped, not repaired
    assert calls == ["https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=30m&range=1mo&includePrePost=false"]
    assert client.get("/api/v1/instruments").json()["items"] == [{"instrument": "SPY", "dataset_ids": [dataset["id"]]}]
    assert len(client.get("/api/v1/market/bars", params={"dataset_id": dataset["id"]}).json()) == 39
    analysis = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "parameters": {"tpo_minutes": 30}})
    assert analysis.status_code == 201, analysis.text
    assert analysis.json()["auction_state"]["session_resets"] is not None


def test_repeating_an_identical_load_reuses_the_dataset(make_client):
    client = make_client(fetcher(chart()))
    first = client.post("/api/v1/datasets/from-symbol", json={"symbol": "SPY"})
    again = client.post("/api/v1/datasets/from-symbol", json={"symbol": "SPY"})
    assert (first.status_code, again.status_code) == (201, 200) and again.json() == first.json()
    assert len(client.get("/api/v1/instruments").json()["items"][0]["dataset_ids"]) == 1


def test_unknown_symbol_and_provider_failures_store_nothing(make_client):
    missing = {"chart": {"result": None, "error": {"code": "Not Found", "description": "No data found, symbol may be delisted"}}}
    client = make_client(fetcher(missing))
    response = client.post("/api/v1/datasets/from-symbol", json={"symbol": "ZZZZ"})
    assert response.status_code == 422 and "No market data found for symbol ZZZZ" in response.json()["detail"]

    def down(url):
        raise ProviderUnavailable("Market data provider could not be reached")
    client = make_client(down)
    response = client.post("/api/v1/datasets/from-symbol", json={"symbol": "SPY"})
    assert response.status_code == 502 and "could not be reached" in response.json()["detail"]
    garbage = make_client(lambda url: b"<html>rate limited</html>")
    assert garbage.post("/api/v1/datasets/from-symbol", json={"symbol": "SPY"}).status_code == 502
    for each in (client, garbage):
        assert each.get("/api/v1/instruments").json()["items"] == []


@pytest.mark.parametrize("body", [{"symbol": "../etc"}, {"symbol": ""}, {"symbol": "1ABC"}, {"symbol": "A" * 17},
                                  {"symbol": "SPY", "timeframe_minutes": 60}, {"symbol": "SPY", "period": "10y"}])
def test_invalid_requests_never_reach_the_provider(make_client, body):
    calls = []
    client = make_client(fetcher(chart(), calls))
    assert client.post("/api/v1/datasets/from-symbol", json=body).status_code == 422
    assert calls == []


def test_provider_drops_forming_null_and_off_session_bars():
    payload = chart(null_at=3)
    now = pd.Timestamp("2025-03-05 10:05", tz="America/New_York").to_pydatetime()
    source, raw = YahooChartProvider("SPY", fetch=fetcher(payload), now=lambda: now).read()
    lines = raw.decode().strip().splitlines()
    assert lines[0] == "timestamp,open,high,low,close,volume"
    # 2 full days (26) minus the null bar, plus the 09:30 bar on 3/5 (09:30–10:00 has completed by 10:05)
    assert len(lines) - 1 == 26 - 1 + 1
    assert lines[-1].startswith("2025-03-05T09:30:00-05:00")
    assert not any("T16:00" in line for line in lines)
    assert source.instrument == "SPY" and source.price_adjustment == "split_adjusted"


def test_provider_rejects_weekend_stamps_and_empty_results():
    weekend = chart(days=["2025-03-08"])  # Saturday
    with pytest.raises(ValueError, match="No completed regular-session bars"):
        YahooChartProvider("SPY", fetch=fetcher(weekend), now=lambda: datetime(2025, 3, 10, tzinfo=UTC)).read()
    with pytest.raises(SymbolNotFound):
        YahooChartProvider("ZZZZ", fetch=fetcher({"chart": {"result": None, "error": {"code": "Not Found"}}})).read()
    with pytest.raises(ProviderUnavailable):
        YahooChartProvider("SPY", fetch=lambda url: b"{").read()


def assert_provider_rejected_without_storage(make_client, payload):
    client = make_client(fetcher(payload))
    response = client.post("/api/v1/datasets/from-symbol", json={"symbol": "SPY"})
    assert response.status_code == 502, response.text
    assert "unreadable response" in response.json()["detail"]
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM datasets").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM analyses").fetchone()[0] == 0


def test_mismatched_symbol_is_rejected_before_storage(make_client):
    assert_provider_rejected_without_storage(make_client, chart(symbol="QQQ"))


def test_symbol_identity_is_case_insensitive(make_client):
    client = make_client(fetcher(chart(symbol="spy")))
    response = client.post("/api/v1/datasets/from-symbol", json={"symbol": "SPY"})
    assert response.status_code == 201
    assert response.json()["source"]["instrument"] == "SPY"


@pytest.mark.parametrize("column", ["open", "high", "low", "close", "volume"])
@pytest.mark.parametrize("change", ["short", "long"])
def test_misaligned_columns_are_rejected_before_storage(make_client, column, change):
    payload = chart()
    values = payload["chart"]["result"][0]["indicators"]["quote"][0][column]
    if change == "short":
        del values[13:]
    else:
        values.append(values[-1])
    assert_provider_rejected_without_storage(make_client, payload)


@pytest.mark.parametrize("payload", [
    None, [], {}, {"chart": None}, {"chart": []}, {"chart": {}},
    {"chart": {"result": None, "error": {"code": "Rate Limited"}}},
    {"chart": {"result": []}}, {"chart": {"result": {"timestamp": []}}},
    {"chart": {"result": [None]}}, {"chart": {"result": [7]}},
    {"chart": {"result": [[]]}},
])
def test_malformed_response_shapes_are_502_without_storage(make_client, payload):
    assert_provider_rejected_without_storage(make_client, payload)


@pytest.mark.parametrize("field,value", [
    ("meta", None), ("meta", {}), ("meta", {"symbol": 7}),
    ("timestamp", None), ("timestamp", "not an array"),
    ("timestamp", [None]), ("timestamp", [True]),
    ("timestamp", [float("nan")]), ("timestamp", [float("inf")]),
    ("timestamp", [10**100]), ("indicators", None),
    ("indicators", {"quote": []}), ("indicators", {"quote": [None]}),
])
def test_malformed_result_fields_are_502_without_storage(make_client, field, value):
    payload = chart()
    payload["chart"]["result"][0][field] = value
    assert_provider_rejected_without_storage(make_client, payload)


def test_empty_valid_series_remains_no_bars_rejection(make_client):
    client = make_client(fetcher(chart(days=[])))
    response = client.post("/api/v1/datasets/from-symbol", json={"symbol": "SPY"})
    assert response.status_code == 422 and "No bars returned" in response.json()["detail"]
    assert client.get("/api/v1/instruments").json()["items"] == []
