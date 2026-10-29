"""Frozen equity profile output: must stay byte-identical when grain branches are added."""
import json
from pathlib import Path

from app.data import ingest
from app.models import Parameters, Source
from app.profiles import profile, profiles

HERE = Path(__file__).parent
SOURCE = Source(instrument="DEMO", price_adjustment="unadjusted", volume_adjustment="raw", source_name="golden")
PARAMS = Parameters(bin_size=0.25)


def _snapshot():
    _, bars = ingest((HERE / "fixtures" / "equity_demo.csv").read_bytes(), SOURCE)
    sessions = [p.model_dump(mode="json") for p in profiles(bars, SOURCE, PARAMS)]
    composite = profile(bars, SOURCE, PARAMS, scope="composite").model_dump(mode="json")
    return {"sessions": sessions, "composite": composite}


def test_equity_profiles_match_golden():
    golden = json.loads((HERE / "fixtures" / "equity_golden.json").read_text(encoding="utf-8"))
    assert json.loads(json.dumps(_snapshot())) == golden
