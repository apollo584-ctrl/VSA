import itertools

import pytest
from pydantic import ValidationError

from app.data import ingest
from app.grade import SPECS_LIMITATION, YAHOO_LIMITATION, GradeResult, grade_equity, grade_futures
from app.interpretation import interpret
from app.models import Analysis, AnalyzeRequest, Dataset, Source
from scripts.demo import demo_csv, demo_source

NEW_KEYS = {"data_grade", "grade_basis", "limitations"}


def fut(tf=30, window=True, total=100, ph=0, off=0, spec="verified"):
    return grade_futures(tf, window, total, ph, off, spec)


def test_daily_is_c_and_blocks_intraday():
    r = fut(tf=1440)
    assert (r.grade, r.basis, r.intraday_profile_allowed) == ("C", "daily bars", False)
    assert r.reason == "Daily bars cannot support an intraday profile"
    assert YAHOO_LIMITATION in r.limitations


def test_daily_ignores_window_flag():
    assert fut(tf=1440, window=False).grade == "C"


def test_intraday_outside_window_has_no_grade():
    r = fut(window=False)
    assert r.grade is None and r.intraday_profile_allowed is False
    assert "unsupported" in r.reason and "roll" in r.reason


def test_intraday_clean_is_b():
    r = fut(tf=15)
    assert (r.grade, r.basis, r.intraday_profile_allowed, r.reason) == ("B", "estimated from 15-minute bars", True, None)
    assert r.limitations == [YAHOO_LIMITATION]


@pytest.mark.parametrize("ph,off", [(1, 0), (0, 1), (3, 2)])
def test_placeholders_or_off_grid_lower_to_c(ph, off):
    r = fut(ph=ph, off=off)
    assert r.grade == "C" and r.intraday_profile_allowed is False
    if ph:
        assert any(str(ph) in s and "placeholder" in s for s in r.limitations)
    if off:
        assert any(str(off) in s and "grid" in s for s in r.limitations)


def test_placeholder_boundary_all_bars():
    assert fut(total=10, ph=9).grade == "C"
    r = fut(total=10, ph=10)
    assert r.grade is None and r.intraday_profile_allowed is False


def test_zero_bars_no_grade():
    r = fut(total=0)
    assert r.grade is None and r.intraday_profile_allowed is False


@pytest.mark.parametrize("spec", ["unverified", "", "pending"])
def test_unverified_spec_adds_limitation_without_lowering(spec):
    r = fut(spec=spec)
    assert r.grade == "B" and SPECS_LIMITATION in r.limitations
    assert SPECS_LIMITATION not in fut(spec="verified").limitations


def test_equity_grade_is_noop():
    assert grade_equity() == GradeResult(None, None, [], True, None)


def test_grade_result_frozen():
    with pytest.raises(Exception):
        fut().grade = "A"


def test_grade_a_unreachable():
    for tf, w, tot, ph, off, spec in itertools.product(
            [1, 5, 15, 30, 60, 1440], [True, False], [0, 1, 10, 1000], [0, 1, 10, 1000], [0, 1, 7], ["verified", "unverified"]):
        assert fut(tf, w, tot, ph, off, spec).grade != "A"


def src(**kw):
    base = dict(instrument="TEST", price_adjustment="unadjusted", volume_adjustment="raw", source_name="t")
    base.update(kw)
    return Source(**base)


def fsrc(**kw):
    base = dict(instrument="ZCZ26", contract="ZCZ26", market="cbot_grains", exchange="CBOT", timezone="America/Chicago")
    base.update(kw)
    return src(**base)


def test_equity_defaults_unchanged():
    s = src()
    assert (s.market, s.exchange, s.contract, s.timeframe_minutes) == ("equity_xnys", "XNYS", None, 5)


def test_valid_futures_source():
    assert fsrc().contract == "ZCZ26"
    assert fsrc(timeframe_minutes=1440).timeframe_minutes == 1440


@pytest.mark.parametrize("kw", [
    dict(exchange="CBOT"), dict(contract="ZCZ26"), dict(timeframe_minutes=1440),
])
def test_invalid_equity_combos(kw):
    with pytest.raises(ValidationError):
        src(**kw)


@pytest.mark.parametrize("kw", [
    dict(exchange="XNYS"), dict(timezone="America/New_York"), dict(contract=None),
    dict(instrument="ZSX26"), dict(contract="zcz26"), dict(contract="ZCA26"), dict(contract="ZCZ2"),
])
def test_invalid_futures_combos(kw):
    with pytest.raises(ValidationError):
        fsrc(**kw)


def test_bad_exchange_and_market_rejected():
    with pytest.raises(ValidationError):
        src(exchange="NASDAQ")
    with pytest.raises(ValidationError):
        src(market="other")


def test_old_dataset_and_analysis_json_load():
    dataset, bars = ingest(demo_csv(), demo_source())
    result = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id))
    old_ds = dataset.model_dump(mode="json", exclude=NEW_KEYS)
    old_ds["source"] = {k: v for k, v in old_ds["source"].items() if k not in ("market", "contract")}
    loaded = Dataset.model_validate(old_ds)
    assert loaded.data_grade is None and loaded.limitations == [] and loaded.source.market == "equity_xnys"
    old_an = result.model_dump(mode="json", exclude=NEW_KEYS)
    old_an["provenance"] = {k: v for k, v in old_an["provenance"].items() if k not in ("market", "contract")}
    for p in old_an["profile_analysis"]:
        p.pop("data_grade", None), p.pop("grade_basis", None)
    assert Analysis.model_validate(old_an).data_grade is None


def test_equity_analysis_serializes_with_only_new_keys():
    dataset, bars = ingest(demo_csv(), demo_source())
    result = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id))
    full = result.model_dump(mode="json")
    assert (full["data_grade"], full["grade_basis"], full["limitations"]) == (None, None, [])
    assert full["provenance"]["market"] == "equity_xnys" and full["provenance"]["contract"] is None
    stripped = result.model_dump(mode="json", exclude=NEW_KEYS)
    assert {k for k in full if k not in stripped} == NEW_KEYS
    for p in full["profile_analysis"]:
        assert p["data_grade"] is None and p["grade_basis"] is None
