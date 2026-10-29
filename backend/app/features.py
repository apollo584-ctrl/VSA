"""Prior-only baselines. A bar's complete OHLCV is observable at its end."""
from collections import defaultdict
from zoneinfo import ZoneInfo

import numpy as np

from app.models import Bar, Parameters


def _true_ranges(bars: list[Bar]):
    ranges = []
    for j, b in enumerate(bars):
        tr = b.high - b.low
        if j:
            c = bars[j - 1].close
            tr = max(tr, abs(b.high - c), abs(b.low - c))
        ranges.append(tr)
    return ranges


def _atr_before(tr, i, period):
    """Mean true range of the `period` bars before bar i; None if fewer exist."""
    return float(np.mean(tr[i - period:i])) if i >= period else None


def _regime_inputs(tr, i, p):
    atr = _atr_before(tr, i, p.atr_period)
    prior = [a for a in (_atr_before(tr, j, p.atr_period) for j in range(max(0, i - p.regime_window), i)) if a is not None]
    median = float(np.median(prior)) if len(prior) >= 20 else None
    return atr, median


def _trend(history, atr, p, progress):
    slope = move = None
    if len(history) >= p.minimum_history:
        x = np.arange(len(history), dtype=float)
        y = np.array([b.close for b in history], dtype=float)
        xc = x - x.mean()
        slope = float(np.dot(xc, y - y.mean()) / np.dot(xc, xc))
        if slope is not None and atr:
            move = slope * (len(history) - 1) / atr
    if p.trend_method == "close_difference":
        background = "up" if progress is not None and progress > 0 else                      "down" if progress is not None and progress < 0 else "indeterminate"
    elif move is None:
        background = "indeterminate"
    else:
        background = "up" if move >= p.trend_atr_threshold else "down" if move <= -p.trend_atr_threshold else "flat"
    return slope, move, background


def features(bars: list[Bar], p: Parameters):
    result = []
    tr = _true_ranges(bars)
    tod_history = defaultdict(list)
    for i, bar in enumerate(bars):
        history = bars[max(0, i - p.lookback):i]
        spread = bar.high - bar.low
        close_location = (bar.close - bar.low) / spread if spread else 0.5
        mean_volume = float(np.mean([b.volume for b in history])) if len(history) >= p.minimum_history else None
        mean_spread = float(np.mean([b.high - b.low for b in history])) if len(history) >= p.minimum_history else None
        # A UTC offset changes at DST; local slot remains stable across sessions.
        local = bar.timestamp.astimezone(ZoneInfo("America/New_York"))
        slot = (local.hour, local.minute)
        prior_slots = tod_history[slot][-p.lookback:]
        tod_mean = float(np.mean(prior_slots)) if len(prior_slots) >= p.tod_minimum_sessions else None
        displacement = bar.close - bar.open
        progress = history[-1].close - history[0].close if len(history) >= p.minimum_history else None
        relative_volume = bar.volume / mean_volume if mean_volume else None
        relative_spread = spread / mean_spread if mean_spread else None
        atr, atr_median = _regime_inputs(tr, i, p)
        if atr is None or atr_median is None:
            regime = "indeterminate"
        elif not atr_median:
            regime = "indeterminate"
        else:
            ratio = atr / atr_median
            regime = "low" if ratio < p.regime_low else "high" if ratio > p.regime_high else "normal"
        trend_slope, trend_move_atr, background = _trend(history, atr, p, progress)
        result.append({"baseline_bars": float(len(history)), "spread": spread, "close_location": close_location,
                       "volume_ma": mean_volume, "relative_volume": relative_volume,
                       "relative_spread": relative_spread, "tod_relative_volume": bar.volume / tod_mean if tod_mean else None,
                       "tod_prior_sessions": float(len(prior_slots)),
                       "upper_wick": (bar.high - max(bar.open, bar.close)) / spread if spread else 0.0,
                       "lower_wick": (min(bar.open, bar.close) - bar.low) / spread if spread else 0.0,
                       "displacement": displacement, "directional_progress": progress,
                       "progress_per_volume": abs(displacement) / bar.volume if bar.volume else None,
                       "background": background, "atr": atr, "atr_median": atr_median,
                       "volatility_regime": regime, "trend_slope": trend_slope, "trend_move_atr": trend_move_atr,
                       "prior_high": max((b.high for b in history), default=None) if len(history) >= p.minimum_history else None,
                       "prior_low": min((b.low for b in history), default=None) if len(history) >= p.minimum_history else None})
        tod_history[slot].append(bar.volume)
    return result
