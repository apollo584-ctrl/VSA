"""Exact-decimal, tick-based bin math. Pure functions, no float arithmetic."""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable

_OFF_GRID_TOLERANCE = Decimal("0.000001")  # fraction of a tick
# Yahoo returns prices rounded to 32-bit floats (relative error up to about 6e-8); allow 2**-23 of the price.
_FLOAT32_REL_TOLERANCE = Decimal("0.00000012")


def _dec(value) -> Decimal:
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    if not d.is_finite():
        raise ValueError("non-finite value")
    return d


def snap_to_tick(price, tick) -> tuple[Decimal, bool]:
    """Nearest tick multiple, and whether the price was off the tick grid."""
    p, t = _dec(price), _dec(tick)
    if t <= 0:
        raise ValueError("tick must be positive")
    snapped = (p / t).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * t
    off_grid = abs(p - snapped) > max(_OFF_GRID_TOLERANCE * t, _FLOAT32_REL_TOLERANCE * abs(p))
    return snapped, off_grid


def off_grid_count(prices: Iterable, tick) -> int:
    return sum(1 for p in prices if snap_to_tick(p, tick)[1])


def _floor_div(a: Decimal, b: Decimal) -> int:
    q, r = divmod(a, b)  # Decimal divmod truncates toward zero
    return int(q) - 1 if r < 0 else int(q)


def _bin_count(low: Decimal, high: Decimal, width: Decimal) -> int:
    return _floor_div(high, width) - _floor_div(low, width) + 1


def bin_multiple(tick, low, high, max_bins: int = 2000) -> int:
    t, lo, hi = _dec(tick), _dec(low), _dec(high)
    if t <= 0:
        raise ValueError("tick must be positive")
    if lo > hi:
        raise ValueError("low must not exceed high")
    if max_bins < 1:
        raise ValueError("max_bins must be at least 1")
    # Below this multiple the bin count provably exceeds max_bins.
    m = max(1, int((hi - lo) / t // max_bins))
    while _bin_count(lo, hi, m * t) > max_bins:
        m += 1
    return m


def bin_size_for(tick, low, high, max_bins: int = 2000) -> tuple[Decimal, int]:
    m = bin_multiple(tick, low, high, max_bins)
    return _dec(tick) * m, m


def bin_index(price, bin_size: Decimal) -> int:
    size = _dec(bin_size)
    if size <= 0:
        raise ValueError("bin_size must be positive")
    return _floor_div(_dec(price), size)


def bin_edges(low_index: int, high_index: int, bin_size: Decimal) -> list[Decimal]:
    """Lower edges for indices low_index..high_index, anchored at zero."""
    size = _dec(bin_size)
    return [size * i for i in range(low_index, high_index + 1)]
