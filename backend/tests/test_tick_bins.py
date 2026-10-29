from decimal import Decimal as D

import pytest

from app.bins import (
    bin_edges,
    bin_index,
    bin_multiple,
    bin_size_for,
    off_grid_count,
    snap_to_tick,
)


@pytest.mark.parametrize(
    "price,tick,expected",
    [
        ("432.75", "0.25", "432.75"),
        ("350.10", "0.10", "350.10"),
        ("45.37", "0.01", "45.37"),
        ("12.345", "0.005", "12.345"),
        (0.07, "0.01", "0.07"),
    ],
)
def test_snap_on_grid_markets(price, tick, expected):
    snapped, off = snap_to_tick(price, tick)
    assert snapped == D(expected)
    assert off is False


def test_snap_off_grid():
    snapped, off = snap_to_tick("432.7499", "0.25")
    assert snapped == D("432.75")
    assert off is True
    snapped, off = snap_to_tick("432.75", "0.25")
    assert off is False
    # tiny noise below 1e-6 * tick still counts as on-grid
    assert snap_to_tick("432.7499999", "0.25") == (D("432.75"), False)
    assert snap_to_tick("432.80", "0.25") == (D("432.75"), True)
    assert snap_to_tick("432.90", "0.25") == (D("433.00"), True)


def test_snap_float_traps():
    snapped, off = snap_to_tick(0.1 + 0.2, "0.1")
    assert snapped == D("0.3") and off is False
    assert snap_to_tick(0.07, "0.01") == (D("0.07"), False)


def test_off_grid_count():
    prices = ["432.75", "432.7499", "433.00", "433.1", 0.1 + 0.2]
    assert off_grid_count(prices, "0.25") == 3
    assert off_grid_count([], "0.25") == 0


def test_bin_multiple_small_range_is_one():
    assert bin_multiple("0.25", "400", "450") == 1
    assert bin_multiple("0.25", "432.75", "432.75") == 1


def test_bin_multiple_zl_range():
    m = bin_multiple("0.01", "40.00", "80.00")
    assert m > 1
    tick = D("0.01")

    def count(k):
        w = tick * k
        return int(D("80.00") // w) - int(D("40.00") // w) + 1

    assert count(m) <= 2000
    assert count(m - 1) > 2000
    size, mult = bin_size_for("0.01", "40.00", "80.00")
    assert mult == m and size == tick * m


def test_bin_multiple_exact_boundary():
    # 1999 ticks apart, aligned -> exactly 2000 bins at m=1
    assert bin_multiple("1", "0", "1999") == 1
    assert bin_multiple("1", "0", "2000") == 2
    assert bin_multiple("1", "0", "1999", max_bins=1999) == 2


def test_bin_multiple_bad_inputs():
    with pytest.raises(ValueError):
        bin_multiple("0", "1", "2")
    with pytest.raises(ValueError):
        bin_multiple("-0.25", "1", "2")
    with pytest.raises(ValueError):
        bin_multiple("0.25", "5", "2")
    with pytest.raises(ValueError):
        bin_multiple("0.25", float("nan"), "2")
    with pytest.raises(ValueError):
        bin_multiple("0.25", "1", float("inf"))
    with pytest.raises(ValueError):
        snap_to_tick("1", "0")


def test_bin_index_exact():
    assert bin_index(432.75, D("0.25")) == 1731
    assert bin_index("432.7499999", D("0.25")) == 1730
    assert bin_index(0.3, D("0.1")) == 3  # float trap: 0.3 // 0.1 == 2.0 in floats
    assert bin_index("-0.01", D("0.25")) == -1


def test_bin_edges_are_tick_multiples():
    for tick, low, high in [("0.25", "400", "450"), ("0.01", "40", "80"), ("0.005", "10", "11")]:
        size, m = bin_size_for(tick, low, high)
        edges = bin_edges(bin_index(low, size), bin_index(high, size), size)
        assert edges[0] <= D(low) and edges[-1] <= D(high) < edges[-1] + size
        assert len(edges) <= 2000
        for e in edges:
            assert e % D(tick) == 0
            assert (e / size) == (e / size).to_integral_value()


def test_float32_rounded_yahoo_prices_are_on_grid():
    from app import bins
    for price in (67.69000244140625, 68.27999877929688, 67.4000015258789, 453.0):
        assert not bins.snap_to_tick(price, "0.01" if price < 100 else "0.25")[1]
    # a real one-hundredth-of-a-cent miss stays off-grid
    assert bins.snap_to_tick(67.695, "0.01")[1]
    assert bins.snap_to_tick(432.7499, "0.25")[1]
