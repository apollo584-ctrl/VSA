from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import markets
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
    assert contract_last_trade_date("ZSX26") == date(2026, 11, 13)
    # 15 Mar 2027 is a Monday: 14th Sunday, 13th Saturday, so Friday the 12th
    assert contract_last_trade_date("ZCH27") == date(2027, 3, 12)
    # 15 Jan 2027 Friday: 14th Thursday
    assert contract_last_trade_date("ZSF27") == date(2027, 1, 14)
    # 15 Jan 2024 is MLK Monday: 14th Sunday, so Friday the 12th
    assert contract_last_trade_date("ZSF24") == date(2024, 1, 12)


@pytest.mark.parametrize("bad", ["ZZZ26", "ZNZ26", "ZCG26", "ZCF27", "ZLG26", "SBH26"])
def test_unsupported_root_or_month_rejected(bad):
    with pytest.raises(ValueError):
        contract_parts(bad)
    with pytest.raises(ValueError):
        contract_last_trade_date(bad)


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


def test_intraday_daily_style_row_rejected():
    # intraday ingest now exists; a bare Saturday date is midnight Chicago on a closed day
    with pytest.raises(ValueError, match="Row 2"):
        ingest(rows("2026-10-31,1,2,1,2,5"), src(timeframe=30))


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


@pytest.mark.parametrize("contract", ["ZZZ26", "ZNZ26", "ZCG26"])
def test_ingest_rejects_unsupported_root_or_unlisted_month(contract):
    with pytest.raises(ValueError):
        ingest(GOOD, src(contract))


# ---- intraday grain ingest (3.1b-U2) ----
_CHI = ZoneInfo("America/Chicago")


def slot_starts(trade_date, step):
    out = []
    for start, end in markets.session_windows(trade_date, markets.get_market("cbot_grains")):
        t = start
        while t < end:
            out.append(t)
            t += timedelta(minutes=step)
    return out


def chicago_stamp(t):
    return t.astimezone(_CHI).strftime("%Y-%m-%dT%H:%M:%S")


def intraday_csv(dates, step, aware=False, skip=lambda t: False, line=None):
    lines = []
    for d in dates:
        for t in slot_starts(d, step):
            if skip(t):
                continue
            stamp = t.isoformat() if aware else chicago_stamp(t)
            lines.append(line(t) if line else f"{stamp},430.25,430.50,430.00,430.25,10")
    return rows(*lines)


@pytest.mark.parametrize("step", [30, 15, 5])
def test_intraday_happy_paths(step):
    dataset, bars = ingest(intraday_csv([date(2026, 10, 27)], step), src(timeframe=step))
    assert dataset.data_grade == "B" and dataset.grade_basis == f"estimated from {step}-minute bars"
    assert {b.session for b in bars} == {"2026-10-27"}
    assert dataset.quality.incomplete_sessions == [] and dataset.quality.missing_bars == 0
    assert any("partial" in x for x in dataset.limitations)
    for b in bars:
        assert b.available_at == b.timestamp + timedelta(minutes=step)
    assert bars[0].timestamp == datetime(2026, 10, 27, 0, 0, tzinfo=timezone.utc)


def test_short_last_slots_30m():
    _, bars = ingest(intraday_csv([date(2026, 10, 27)], 30), src(timeframe=30))
    stamps = [b.timestamp.astimezone(_CHI).strftime("%H:%M") for b in bars]
    assert "07:30" in stamps and stamps[-1] == "13:00"
    # available_at is start + the full step even for the short last slot
    assert bars[-1].available_at - bars[-1].timestamp == timedelta(minutes=30)


def test_aware_timestamps_accepted():
    dataset, _ = ingest(intraday_csv([date(2026, 10, 27)], 30, aware=True), src(timeframe=30))
    assert dataset.data_grade == "B"


def test_mixed_naive_aware_rejected():
    body = rows("2026-10-27T00:00:00,430,431,429,430,5", "2026-10-27T05:30:00+00:00,430,431,429,430,5")
    with pytest.raises(ValueError, match="mix naive"):
        ingest(body, src(timeframe=30))


def test_intraday_duplicates_rejected():
    with pytest.raises(ValueError, match="strictly increasing"):
        ingest(rows("2026-10-27T00:00:00,1,2,1,2,5", "2026-10-27T00:00:00,1,2,1,2,5"), src(timeframe=30))


def test_nanosecond_timestamps_rejected():
    body = rows("2026-10-26T19:00:00.000000001,1,2,1,2,5", "2026-10-26T19:00:00.000000002,1,2,1,2,5")
    with pytest.raises(ValueError, match="Row 2"):
        ingest(body, src(timeframe=30))


def test_bar_end_rejected():
    s = src(timeframe=30).model_copy(update={"timestamp_convention": "bar_end"})
    with pytest.raises(ValueError, match="bar_start"):
        ingest(intraday_csv([date(2026, 10, 27)], 30), s)


def test_ambiguous_and_nonexistent_rejected():
    with pytest.raises(ValueError, match="Row 2"):
        ingest(rows("2026-11-01T01:30:00,1,2,1,2,5"), src(timeframe=30))
    with pytest.raises(ValueError, match="Row 2"):
        ingest(rows("2027-03-14T02:30:00,1,2,1,2,5"), src("ZCK27", timeframe=30))


@pytest.mark.parametrize("stamp", [
    "2026-10-27T07:45:00",   # break
    "2026-10-27T13:30:00",   # after close
    "2026-10-27T09:10:00",   # off grid
    "2026-10-30T14:00:00",   # Friday after close
    "2026-10-31T10:00:00",   # Saturday
])
def test_grain_slot_rejections_become_row_errors(stamp):
    with pytest.raises(ValueError, match="Row 3: "):
        ingest(rows("2026-10-27T07:30:00,1,2,1,2,5", f"{stamp},1,2,1,2,5"), src(timeframe=30))


def test_intraday_expiry_rejected():
    with pytest.raises(ValueError, match="bar after contract expiry"):
        ingest(rows("2026-12-15T09:00:00,1,2,1,2,5"), src(timeframe=30))


def test_intraday_ohlc_checks_apply():
    with pytest.raises(ValueError, match="Row 2: inconsistent OHLC"):
        ingest(rows("2026-10-27T09:00:00,430,429,431,430,5"), src(timeframe=30))
    with pytest.raises(ValueError, match="Row 2: OHLCV must be numeric"):
        ingest(rows("2026-10-27T09:00:00,x,429,431,430,5"), src(timeframe=30))


def test_dst_weeks_ingest():
    for d, contract in ((date(2026, 11, 2), "ZCZ26"), (date(2027, 3, 15), "ZCK27")):
        dataset, _ = ingest(intraday_csv([d], 30), src(contract, timeframe=30))
        assert dataset.data_grade == "B" and dataset.quality.incomplete_sessions == []


def test_contract_required_for_grain():
    s = Source.model_construct(**{**src(timeframe=30).model_dump(), "contract": None})
    with pytest.raises(ValueError):
        ingest(intraday_csv([date(2026, 10, 27)], 30), s)


def test_temporary_intraday_profile_guard(tmp_path):
    with TestClient(create_app(tmp_path / "g.sqlite3"), client=("127.0.0.1", 50000),
                    base_url="http://localhost") as client:
        r = client.post("/api/v1/datasets/upload",
                        files={"file": ("z.csv", intraday_csv([date(2026, 10, 27)], 30), "text/csv")},
                        data={"metadata": src(timeframe=30).model_dump_json()})
        assert r.status_code == 201, r.text
        assert r.json()["data_grade"] == "B"
        p = client.get("/api/v1/profiles", params={"dataset_id": r.json()["id"]})
        assert p.status_code == 422
        assert p.json()["detail"]["reason"] == "Intraday grain profiles are not supported yet"
        assert p.json()["detail"]["data_grade"] == "B"
