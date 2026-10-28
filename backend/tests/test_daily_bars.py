import json
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import auth
from app.main import create_app
from app.providers import ProviderUnavailable


def payload(symbol="AAA", days=550):
    start = date(2024, 1, 1)
    stamps, closes = [], []
    d = start
    while len(stamps) < days:
        if d.weekday() < 5:
            stamps.append(int(datetime(d.year, d.month, d.day, 15, tzinfo=timezone.utc).timestamp()))
            closes.append(100 + len(stamps) * 0.1)
        d += timedelta(days=1)
    quote = {"open": closes, "high": [c + 1 for c in closes], "low": [c - 1 for c in closes], "close": closes,
             "volume": [1000] * days}
    return {"chart": {"result": [{"meta": {"symbol": symbol}, "timestamp": stamps, "indicators": {"quote": [quote]}}], "error": None}}


def client(tmp_path, fetch):
    return TestClient(create_app(tmp_path / "t.sqlite3", market_fetch=fetch), client=("127.0.0.1", 1), base_url="http://localhost")


def test_shape_and_last_500(tmp_path):
    calls = []

    def fetch(url):
        calls.append(url)
        return json.dumps(payload("AAA")).encode()

    with client(tmp_path, fetch) as c:
        r = c.get("/api/v1/daily-bars?symbol=aaa")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "AAA" and len(body["bars"]) == 500
    assert set(body["bars"][0]) == {"session", "open", "high", "low", "close", "volume"}
    assert body["bars"][-1]["volume"] == 1000 and body["bars"][-1]["high"] > body["bars"][-1]["low"]
    assert body["bars"] == sorted(body["bars"], key=lambda b: b["session"])
    assert body["bars"][-1]["close"] == round(100 + 550 * 0.1, 10) or abs(body["bars"][-1]["close"] - 155.0) < 1e-9


def test_cache_hit_does_not_refetch(tmp_path):
    calls = []

    def fetch(url):
        calls.append(url)
        return json.dumps(payload("AAA", 30)).encode()

    with client(tmp_path, fetch) as c:
        assert c.get("/api/v1/daily-bars?symbol=AAA").status_code == 200
        assert c.get("/api/v1/daily-bars?symbol=AAA").status_code == 200
    assert len(calls) == 1


def test_bad_symbol_422(tmp_path):
    with client(tmp_path, lambda url: b"") as c:
        for s in ("1ABC", "A B", "WAYTOOLONGSYMBOLXYZ", "", "A/B"):
            assert c.get("/api/v1/daily-bars", params={"symbol": s}).status_code == 422
        assert c.get("/api/v1/daily-bars").status_code == 422


def test_unknown_symbol_422_and_provider_failure_502(tmp_path):
    missing = {"chart": {"result": None, "error": {"code": "Not Found"}}}
    with client(tmp_path, lambda url: json.dumps(missing).encode()) as c:
        assert c.get("/api/v1/daily-bars?symbol=ZZZ").status_code == 422

    def down(url):
        raise ProviderUnavailable("Market data provider could not be reached")

    with client(tmp_path / "b", down) as c:
        r = c.get("/api/v1/daily-bars?symbol=AAA")
    assert r.status_code == 502 and "could not be reached" in r.json()["detail"]


def test_lan_client_without_session_401(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "ITERATIONS", 1000)
    monkeypatch.delenv("MSI_AUTH_PATH", raising=False)
    tmp_path.mkdir(parents=True, exist_ok=True)
    auth.write_pin_file(tmp_path / "auth.json", "123456")
    app = create_app(tmp_path / "t.sqlite3", market_fetch=lambda url: json.dumps(payload()).encode())
    with TestClient(app, client=("192.168.1.50", 50000), base_url="http://192.168.1.20:8000") as c:
        r = c.get("/api/v1/daily-bars?symbol=AAA")
    assert r.status_code == 401 and r.json() == {"detail": "Login required"}
