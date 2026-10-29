import json
from decimal import Decimal
from pathlib import Path

import pytest

from app import markets as m

REG = Path(r"C:\Users\gregd\Codex Projects\Ag Predictor-v2\instruments\registry.json")


def test_equity_spec_unchanged():
    e = m.get_market("equity_xnys")
    assert e.timezone == "America/New_York"
    assert e.market_id == "equity_xnys"
    assert "09:30-16:00" in e.session_template


def test_grain_spec_unverified_and_ticks(monkeypatch):
    monkeypatch.delenv("AG_REGISTRY_PATH", raising=False)
    g = m.get_market("cbot_grains")
    assert g.spec_status == "unverified"
    assert g.timezone == "America/Chicago"
    assert set(g.tick_sizes) == set(m.GRAIN_ROOTS)
    for root, val in {"ZL": "0.01", "ZM": "0.10", "ZR": "0.005", "ZC": "0.25"}.items():
        t = g.tick_size_for(root)
        assert isinstance(t, Decimal) and t == Decimal(val)
        assert str(t) == val
    assert m.HOLIDAY_STATUS == "unverified"


def test_registry_env_overrides(tmp_path, monkeypatch):
    p = tmp_path / "r.json"
    p.write_text(json.dumps({"instruments": [{"symbol": "ZC", "specs": {
        "tick_size": {"value": "0.5"}, "price_unit": {"value": "x"},
        "session_template": {"value": "cbot_grains"}, "listed_months": {"value": "HKNUZ"}}}]}))
    monkeypatch.setenv("AG_REGISTRY_PATH", str(p))
    assert m.get_market("cbot_grains").tick_size_for("ZC") == Decimal("0.5")


def test_snapshot_matches_registry():
    if not REG.exists():
        pytest.skip("registry not present")
    snap = json.loads(m.SNAPSHOT_PATH.read_text(encoding="utf-8"))["instruments"]
    assert snap == m._extract_registry(json.loads(REG.read_text(encoding="utf-8")))
