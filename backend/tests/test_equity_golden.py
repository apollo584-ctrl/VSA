"""Frozen equity profile output: must stay byte-identical when grain branches are added."""
import json
from pathlib import Path

import pytest

from app.data import ingest
from app.models import Parameters, Source
from app.profiles import profile, profiles

HERE = Path(__file__).parent
SOURCE = Source(instrument="DEMO", price_adjustment="unadjusted", volume_adjustment="raw", source_name="golden")
PARAMS = Parameters(bin_size=0.25, value_area_method="one_bin")
PARAMS_TWO_ROW = Parameters(bin_size=0.25, value_area_method="two_row")


def _snapshot(params=PARAMS):
    _, bars = ingest((HERE / "fixtures" / "equity_demo.csv").read_bytes(), SOURCE)
    sessions = [p.model_dump(mode="json") for p in profiles(bars, SOURCE, params)]
    composite = profile(bars, SOURCE, params, scope="composite").model_dump(mode="json")
    return {"sessions": sessions, "composite": composite}


def test_equity_profiles_match_golden():
    golden = json.loads((HERE / "fixtures" / "equity_golden.json").read_text(encoding="utf-8"))
    assert json.loads(json.dumps(_snapshot())) == golden


def _naive_two_row(counts, fraction):
    """Independent plain-list reference of the two-row rule (not shared with app code)."""
    poc = counts.index(max(counts))
    lo = hi = poc
    got, total = counts[poc], sum(counts)
    while got < total * fraction and (lo > 0 or hi < len(counts) - 1):
        down = counts[max(lo - 2, 0):lo][::-1] if lo > 0 else []
        up = counts[hi + 1:hi + 3]
        if down and (not up or sum(down) >= sum(up)):
            lo -= len(down)
            got += sum(down)
        else:
            hi += len(up)
            got += sum(up)
    return lo, hi


def test_equity_two_row_golden():
    """Frozen two_row output; edges are re-derived by the independent reference above."""
    snap = json.loads(json.dumps(_snapshot(PARAMS_TWO_ROW)))
    for prof in snap["sessions"] + [snap["composite"]]:
        for dist in (prof["volume"], prof["tpo"]):
            if dist["poc"] is None:
                continue
            lo, hi = _naive_two_row(dist["counts"], 0.7)
            assert dist["val"] == pytest.approx(prof["price_bin_lower"][lo])
            assert dist["vah"] == pytest.approx(prof["price_bin_lower"][hi] + prof["bin_size"])
    golden = json.loads((HERE / "fixtures" / "equity_golden_two_row.json").read_text(encoding="utf-8"))
    assert snap == golden
