import numpy as np
import pytest

from app.models import Parameters
from app.profiles import distribution, profile, shape
from tests.conftest import make_bar


def test_volume_conservation_and_tpo_deduplication(source):
    bars = [make_bar(i, o=100, h=102, low=100, c=101, volume=90) for i in range(6)]
    result = profile(bars, source, Parameters(bin_size=1))
    assert result.volume.counts == [180, 180, 180]
    assert result.tpo.counts == [1, 1, 1]  # six 5m bars in one 30m TPO
    assert sum(result.volume.counts) == 540
    assert result.volume.poc == 100.5  # explicit lower-bin tie
    assert result.volume.val == 100 and result.volume.vah == 103
    assert result.volume.estimated and result.tpo.estimated


def test_value_area_contiguous_and_zero_weights():
    bars = [make_bar(0)]
    result = distribution(np.array([1., 5., 2., 1.]), np.arange(4) + .5, bars,
                          Parameters(bin_size=1, value_area_fraction=.7, value_area_method="one_bin"), "test")
    assert result.poc == 1.5
    assert result.val == 1 and result.vah == 3
    assert result.achieved_value_fraction == pytest.approx(7 / 9)
    empty = distribution(np.zeros(3), np.arange(3) + .5, bars, Parameters(), "test")
    assert empty.poc is None and empty.vah is None


def test_zero_range_initial_balance_and_bin_limit(source):
    bars = [make_bar(i, o=100, h=100, low=100, c=100, volume=0) for i in range(12)]
    result = profile(bars, source, Parameters())
    assert result.tpo.counts == [2]
    assert result.volume.poc is None
    assert result.initial_balance["complete"] is True
    assert result.range_extension == {"above": 0, "below": 0}
    result = profile(bars[:-1], source, Parameters())
    assert result.initial_balance["complete"] is False
    assert result.range_extension["above"] is None
    with pytest.raises(ValueError, match="2000 bins"):
        profile([make_bar(0)], source, Parameters(bin_size=.0001))


def test_shape_features_are_transparent():
    bars = [make_bar(i) for i in range(6)]
    p = Parameters(bin_size=1)
    assert shape(np.array([1, 3, 6, 3, 1]), bars, p).classification == "D_balanced"
    assert shape(np.array([1, 1, 2, 6, 10]), bars, p).classification == "P_upper_heavy"
    assert shape(np.array([10, 6, 2, 1, 1]), bars, p).classification == "b_lower_heavy"
    assert shape(np.array([1, 10, 1, 0, 1, 10, 1]), bars, p).classification == "B_double_distribution"
    assert shape(np.array([1, 10, 0, 0, 10, 0, 0, 10, 1]), bars, p).classification == "multi_modal"
    assert shape(np.array([0, 0, 0]), bars, p).classification == "unclassified"


def test_decimal_price_bin_boundary(source):
    result = profile([make_bar(0, o=.3, h=.3, low=.3, c=.3, volume=12)], source, Parameters(bin_size=.1))
    assert len(result.volume.counts) == 1
    assert result.price_bin_lower[0] == pytest.approx(.3)
    assert result.volume.counts == [12]
