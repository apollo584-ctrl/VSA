"""Hand-computed value-area tests for the two_row (default) and one_bin methods."""
import numpy as np
import pytest

from app.models import Parameters
from app.profiles import value_area_indices

W = np.array


def test_default_is_two_row():
    assert Parameters().value_area_method == "two_row"


def test_two_row_differs_from_one_bin():
    # total 100, target 70. POC=idx3 (30). Below pair (2,1)=20+10=30, above pair (4,5)=15+15=30? use distinct values.
    w = W([5, 10, 20, 30, 12, 13, 10], dtype=float)  # total 100
    # two_row: below pair idx2,1 = 30; above pair idx4,5 = 25 -> add below: enclosed 60, range 1..3
    # then below pair idx0 (only one) = 5; above pair idx4,5 = 25 -> add above: enclosed 85, range 1..5
    assert value_area_indices(w, 0.7, "two_row") == (3, 1, 5, 85.0)
    # one_bin: left 20 vs right 12 -> left (50); left 10 vs right 12 -> right (62); left 10 vs 13 -> right (75)
    assert value_area_indices(w, 0.7, "one_bin") == (3, 2, 5, 75.0)


def test_two_row_tie_prefers_lower_side():
    w = W([10, 10, 20, 10, 10], dtype=float)  # total 60, target 0.5 -> 30
    assert value_area_indices(w, 0.5, "two_row") == (2, 0, 2, 40.0)


def test_two_row_poc_tie_uses_lowest_price():
    w = W([5, 5, 5], dtype=float)
    poc, *_ = value_area_indices(w, 0.3, "two_row")
    assert poc == 0


def test_two_row_poc_at_first_bin():
    w = W([40, 30, 20, 10], dtype=float)
    # target 70: enclosed 40 -> above pair 50 -> 90 covers 0..2
    assert value_area_indices(w, 0.7, "two_row") == (0, 0, 2, 90.0)


def test_two_row_poc_at_last_bin():
    w = W([10, 20, 30, 40], dtype=float)
    assert value_area_indices(w, 0.7, "two_row") == (3, 1, 3, 90.0)


def test_two_row_single_side_single_bin_added_alone():
    w = W([10, 50, 40], dtype=float)  # POC idx1; below only 1 bin (10), above only 1 bin (40)
    # target 0.9 -> 90: add above 40 (>= 10) -> 90 reached
    assert value_area_indices(w, 0.9, "two_row") == (1, 1, 2, 90.0)


def test_single_bin_and_all_zero():
    assert value_area_indices(W([7.0]), 0.7, "two_row") == (0, 0, 0, 7.0)
    assert value_area_indices(W([0.0, 0.0, 0.0]), 0.7, "two_row") == (0, 0, 0, 0.0)


@pytest.mark.parametrize("method", ["two_row", "one_bin"])
def test_fraction_one_covers_all_bins(method):
    w = W([3, 1, 4, 1, 5, 9, 2, 6], dtype=float)
    poc, low, high, enclosed = value_area_indices(w, 1.0, method)
    assert (low, high, enclosed) == (0, 7, 31.0)


def test_two_row_grain_profile_hand_computed():
    from tests.test_grain_profiles import bar, src, D1
    from app.profiles import profile
    # volume per bin [20, 42.5, 42.5, 22.5, 22.5], total 150, target 105; POC idx1 (lowest of the tie)
    bars = [bar("2026-11-02 19:00", D1, 450.0, 450.5, 450.0, 450.25, 60),
            bar("2026-11-03 08:30", D1, 450.25, 451.0, 450.25, 451.0, 90)]
    two = profile(bars, src(), Parameters(bin_size=0.25, value_area_method="two_row"))
    # two_row: below idx0 = 20 vs above idx2,3 = 65 -> add above (107.5 >= 105): bins 1..3
    assert (two.volume.poc, two.volume.val, two.volume.vah) == (450.375, 450.25, 451.0)
    one = profile(bars, src(), Parameters(bin_size=0.25, value_area_method="one_bin"))
    # one_bin: 20 vs 42.5 -> idx2 (85); 20 vs 22.5 -> idx3 (107.5): same here
    assert (one.volume.val, one.volume.vah) == (450.25, 451.0)


def test_two_row_equity_profile_has_method_independent_shape():
    from pathlib import Path
    from app.data import ingest
    from app.models import Source
    from app.profiles import profile
    src = Source(instrument="DEMO", price_adjustment="unadjusted", volume_adjustment="raw", source_name="t")
    _, bars = ingest((Path(__file__).parent / "fixtures" / "equity_demo.csv").read_bytes(), src)
    for method in ("two_row", "one_bin"):
        prof = profile(bars, src, Parameters(bin_size=0.25, value_area_method=method), scope="composite")
        assert prof.volume.val < prof.volume.poc < prof.volume.vah


def test_endpoint_method_param(tmp_path):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from tests.test_api import upload
    with TestClient(create_app(tmp_path / "va.sqlite3"), client=("127.0.0.1", 50000),
                    base_url="http://localhost") as client:
        ds = upload(client).json()["id"]
        for method in ("two_row", "one_bin"):
            r = client.get("/api/v1/profiles", params={"dataset_id": ds, "value_area_method": method})
            assert r.status_code == 200
        assert client.get("/api/v1/profiles", params={"dataset_id": ds, "value_area_method": "x"}).status_code == 422
