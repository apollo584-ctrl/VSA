from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.data import ingest
from app.main import create_app
from app.markets import contract_last_trade_date, contract_parts
from app.models import Dataset, Source
from app.store import Store
from scripts.demo import demo_csv, demo_source

HEADER = "timestamp,open,high,low,close,volume\n"


def src(contract="ZCZ26", timeframe=1440):
    return Source(instrument=contract, timeframe_minutes=timeframe, exchange="CBOT", market="cbot_grains",
                  contract=contract, timezone="America/Chicago", price_adjustment="unadjusted",
                  volume_adjustment="raw", source_name="Yahoo test")


def rows(*lines):
    return (HEADER + "\n".join(lines) + "\n").encode()


GOOD = rows("2026-10-26,430.00,432.50,429.00,431.25,1000",
            "2026-10-27,431.25,433.00,430.50,432.00,1200",
            "2026-10-28,432.00,434.00,431.00,433.50,900")


def test_contract_parts():
    assert contract_parts("ZCZ26") == ("ZC", "Z", 2026)
    assert contract_parts("KEN27") == ("KE", "N", 2027)
    for bad in ("ZC", "ZCA26", "ZCZ2x", "zcz26", "Z26"):
        with pytest.raises(ValueError):
            contract_parts(bad)


def test_last_trade_date_weekend_and_holiday():
    # 15 Dec 2026 is a Tuesday: day before is Monday 14th
    assert contract_last_trade_date("ZCZ26") == date(2026, 12, 14)
    # 15 Nov 2026 is a Sunday: 14th Sat, 13th Fri
    assert contract_last_trade_date("ZCX26") == date(2026, 11, 13)
    # 15 Jun 2026 Monday: previous open day is Friday 12th
    assert contract_last_trade_date("ZCM26") == date(2026, 6, 12)
    # 15 Jan 2027 Friday: 14th Thursday
    assert contract_last_trade_date("ZCF27") == date(2027, 1, 14)
    # 15 Jan 2024 is MLK Monday: 14th Sunday, so Friday the 12th
    assert contract_last_trade_date("ZCF24") == date(2024, 1, 12)
    # 15 Feb 2027 is Presidents Day Monday: 14th Sunday, so Friday the 12th
    assert contract_last_trade_date("ZCG27") == date(2027, 2, 12)
    # 16 Feb 2026 holiday is not the 14th; 15 Feb 2026 Sunday -> Friday 13th
    assert contract_last_trade_date("ZCG26") == date(2026, 2, 13)


def test_happy_path():
    dataset, bars = ingest(GOOD, src())
    assert dataset.row_count == 3 and dataset.data_grade == "C" and dataset.grade_basis == "daily bars"
    assert any("unofficial" in x for x in dataset.limitations)
    assert [b.session for b in bars] == ["2026-10-26", "2026-10-27", "2026-10-28"]
    assert dataset.quality.missing_bars == 0 and dataset.quality.absent_sessions == []
    assert any("Yahoo" in w for w in dataset.quality.warnings)
    assert bars[0].timestamp < bars[0].available_at


def test_available_at_is_session_close_both_dst_sides():
    # 13:20 CDT = 18:20 UTC; 13:20 CST = 19:20 UTC. Start is 19:00 CT the previous day.
    _, bars = ingest(rows("2026-10-27,1,2,1,2,5", "2026-11-03,1,2,1,2,5"), src())
    assert bars[0].available_at == datetime(2026, 10, 27, 18, 20, tzinfo=timezone.utc)
    assert bars[1].available_at == datetime(2026, 11, 3, 19, 20, tzinfo=timezone.utc)
    assert bars[0].timestamp == datetime(2026, 10, 27, 0, 0, tzinfo=timezone.utc)  # 19:00 CDT on the 26th
    assert bars[1].timestamp == datetime(2026, 11, 3, 1, 0, tzinfo=timezone.utc)  # 19:00 CST on the 2nd


@pytest.mark.parametrize("line,text", [
    ("2026-10-31,1,2,1,2,5", "trading day"),          # Saturday
    ("2026-11-26,1,2,1,2,5", "trading day"),          # Thanksgiving
    ("2026-12-15,1,2,1,2,5", "contract expiry"),
    ("10/27/2026,1,2,1,2,5", "ISO date"),
    ("2026-10-27T13:20:00,1,2,1,2,5", "ISO date"),
])
def test_rejected_dates(line, text):
    with pytest.raises(ValueError, match=text):
        ingest(rows(line), src())


def test_after_expiry_message():
    with pytest.raises(ValueError, match="bar after contract expiry \\(possible contract roll\\)"):
        ingest(rows("2026-12-14,1,2,1,2,5", "2026-12-16,1,2,1,2,5"), src())


def test_intraday_rejected():
    with pytest.raises(ValueError, match="Intraday grain data is not supported yet"):
        ingest(rows("2026-10-27,1,2,1,2,5"), src(timeframe=30))


def test_duplicate_and_decreasing_rejected():
    for body in (rows("2026-10-27,1,2,1,2,5", "2026-10-27,1,2,1,2,5"),
                 rows("2026-10-28,1,2,1,2,5", "2026-10-27,1,2,1,2,5")):
        with pytest.raises(ValueError, match="strictly increasing"):
            ingest(body, src())


def test_zero_volume_placeholder_listed_grade_stays_c():
    dataset, _ = ingest(rows("2026-10-27,430,432,429,431,100", "2026-10-28,431,431,431,431,0"), src())
    assert dataset.data_grade == "C"
    assert any("placeholder" in x for x in dataset.limitations)
    assert any("Zero-volume" in w for w in dataset.quality.warnings)


def test_off_grid_price_listed():
    # ZC tick is 0.25 in the registry snapshot
    dataset, _ = ingest(rows("2026-10-27,430.10,432,429,431,100"), src())
    assert dataset.data_grade == "C"
    assert any("off the contract tick grid" in x for x in dataset.limitations)


def test_missing_open_days_reported():
    dataset, _ = ingest(rows("2026-10-26,1,2,1,2,5", "2026-10-28,1,2,1,2,5"), src())
    assert dataset.quality.absent_sessions == ["2026-10-27"] and dataset.quality.missing_bars == 1


def test_api_gating_and_roundtrip(tmp_path):
    path = tmp_path / "f.sqlite3"
    with TestClient(create_app(path), client=("127.0.0.1", 50000), base_url="http://localhost") as client:
        r = client.post("/api/v1/datasets/upload", files={"file": ("z.csv", GOOD, "text/csv")},
                        data={"metadata": src().model_dump_json()})
        assert r.status_code == 201, r.text
        fut = r.json()
        assert fut["data_grade"] == "C"
        assert client.get(f"/api/v1/datasets/{fut['id']}").json() == fut
        assert len(client.get("/api/v1/market/bars", params={"dataset_id": fut["id"]}).json()) == 3
        p = client.get("/api/v1/profiles", params={"dataset_id": fut["id"]})
        assert p.status_code == 422
        assert p.json()["detail"]["reason"] == "Daily bars cannot support an intraday profile"
        assert p.json()["detail"]["data_grade"] == "C"
        a = client.post("/api/v1/analyze", json={"dataset_id": fut["id"]})
        assert a.status_code == 422 and a.json()["detail"]["data_grade"] == "C"
        eq = client.post("/api/v1/datasets/upload", files={"file": ("d.csv", demo_csv(), "text/csv")},
                         data={"metadata": demo_source().model_dump_json()})
        assert eq.json()["data_grade"] is None
        assert client.get("/api/v1/profiles", params={"dataset_id": eq.json()["id"]}).status_code == 200
    stored, _ = Store(path).dataset(fut["id"])
    assert stored == Dataset.model_validate(fut)
