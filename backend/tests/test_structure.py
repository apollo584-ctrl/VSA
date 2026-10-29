import json
import sqlite3

import pytest

from tests.test_api import _contract_chart, _contract_client

BOUNDARY = "2026-10-13T20:00:00+00:00"
BOUNDARY_EPOCH = 1791921600  # 2026-10-13T20:00:00Z


def _load(c, contract="ZCZ26", **body):
    r = c.post("/api/v1/datasets/from-contract", json={"contract": contract, **body})
    assert r.status_code in (200, 201), r.text
    return r.json()


def _fetch(chart=None):
    chart = chart or _contract_chart()
    return lambda url: json.dumps(chart).encode()


def _lv(d):
    return (d["poc"], d["vah"], d["val"])


def test_structure_matches_profiles_with_prior_session(tmp_path):
    with _contract_client(tmp_path, _fetch()) as c:
        ds = _load(c)
        body = c.get("/api/v1/structure", params={"contract": "ZCZ26"}).json()
        profiles = c.get("/api/v1/profiles", params={"dataset_id": ds["id"]}).json()
        assert body["contract_version"] == "1" and body["market"] == "cbot_grains" and body["root"] == "ZC"
        assert body["dataset_id"] == ds["id"] and body["data_grade"] == "B" and body["timeframe_minutes"] == 30
        assert len(profiles) == 2 and body["latest_session"] == profiles[-1]["session"]
        for got, want in ((body["session_profile"], profiles[-1]), (body["prior_session_profile"], profiles[-2])):
            assert got["session"] == want["session"]
            assert _lv(got["volume"]) == _lv(want["volume"]) and _lv(got["tpo"]) == _lv(want["tpo"])
            assert got["shape"] == want["volume"]["shape"]["classification"] and got["bin_size"] == want["bin_size"]
        assert body["volatility"]["atr_period"] == 14 and body["volatility"]["atr"] is not None
        assert body["value_location"] is None and body["auction_state"] is None
        assert any("not supported for intraday grain" in t for t in body["limitations"])


def test_structure_as_of_hides_later_session_and_has_no_lookahead(tmp_path):
    with _contract_client(tmp_path / "a", _fetch()) as c:
        _load(c)
        early = c.get("/api/v1/structure", params={"contract": "ZCZ26", "as_of": BOUNDARY})
        assert early.status_code == 200, early.text
        body = early.json()
        assert body["prior_session_profile"] is None and body["session_profile"] is not None
        assert body["as_of"].startswith("2026-10-13T20:00:00")

    changed = _contract_chart()
    result = changed["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    cut = sum(1 for t in result["timestamp"] if t > BOUNDARY_EPOCH)
    assert cut > 0
    for key in ("open", "high", "low", "close"):
        quote[key] = quote[key][:-cut] + [v + 3 for v in quote[key][-cut:]]
    quote["volume"] = quote["volume"][:-cut] + [v * 5 for v in quote["volume"][-cut:]]
    with _contract_client(tmp_path / "b", _fetch(changed)) as c2:
        _load(c2)
        again = c2.get("/api/v1/structure", params={"contract": "ZCZ26", "as_of": BOUNDARY}).json()
    for key in ("session_profile", "prior_session_profile", "volatility", "latest_session"):
        assert again[key] == body[key]


@pytest.mark.parametrize("params", [{"contract": "ZCZ26", "as_of": "2026-10-14T12:00:00"}, {"contract": "AAPL"}, {"contract": "ZCX26"}])
def test_structure_rejects_bad_requests(tmp_path, params):
    with _contract_client(tmp_path, _fetch()) as c:
        assert c.get("/api/v1/structure", params=params).status_code == 422


def test_structure_unknown_contract_is_unavailable_shell(tmp_path):
    def no_network(url):
        raise AssertionError("structure must not fetch")

    with _contract_client(tmp_path, no_network) as c:
        r = c.get("/api/v1/structure", params={"contract": "ZCZ26"})
        body = r.json()
        assert r.status_code == 200 and body["contract_version"] == "1"
        for key in ("dataset_id", "data_grade", "timeframe_minutes", "latest_session", "session_profile",
                    "prior_session_profile", "volatility", "value_location", "auction_state", "as_of"):
            assert body[key] is None
        assert any("POST /api/v1/datasets/from-contract" in t for t in body["limitations"])


def test_structure_grade_c_returns_shell_with_reason(tmp_path):
    with _contract_client(tmp_path, _fetch()) as c:
        ds = _load(c)
        db = sqlite3.connect(tmp_path / "c.sqlite3")
        meta = json.loads(db.execute("SELECT metadata FROM datasets").fetchone()[0])
        meta["data_grade"] = "C"
        db.execute("UPDATE datasets SET metadata=?", (json.dumps(meta),))
        db.commit()
        db.close()
        body = c.get("/api/v1/structure", params={"contract": "ZCZ26"}).json()
        assert body["data_grade"] == "C" and body["dataset_id"] == ds["id"]
        assert body["session_profile"] is None and body["prior_session_profile"] is None and body["volatility"] is None
        assert any("Placeholder bars or off-grid prices" in t for t in body["limitations"])
        assert body["contract_version"] == "1"


def test_structure_prefers_larger_timeframe(tmp_path):
    def fetch(url):
        return json.dumps(_contract_chart(minutes=5 if "interval=5m" in url else 30)).encode()

    with _contract_client(tmp_path, fetch) as c:
        _load(c, timeframe_minutes=5, period="5d")
        d30 = _load(c)
        body = c.get("/api/v1/structure", params={"contract": "ZCZ26"}).json()
        assert body["timeframe_minutes"] == 30 and body["dataset_id"] == d30["id"]
