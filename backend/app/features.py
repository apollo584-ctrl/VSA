"""Prior-only baselines. A bar's complete OHLCV is observable at its end."""
from collections import defaultdict
from zoneinfo import ZoneInfo

import numpy as np

from app.models import Bar, Parameters


def features(bars: list[Bar], p: Parameters):
    result = []
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
        result.append({"baseline_bars": float(len(history)), "spread": spread, "close_location": close_location,
                       "volume_ma": mean_volume, "relative_volume": relative_volume,
                       "relative_spread": relative_spread, "tod_relative_volume": bar.volume / tod_mean if tod_mean else None,
                       "tod_prior_sessions": float(len(prior_slots)),
                       "upper_wick": (bar.high - max(bar.open, bar.close)) / spread if spread else 0.0,
                       "lower_wick": (min(bar.open, bar.close) - bar.low) / spread if spread else 0.0,
                       "displacement": displacement, "directional_progress": progress,
                       "progress_per_volume": abs(displacement) / bar.volume if bar.volume else None,
                       "background": "up" if progress is not None and progress > 0 else
                                     "down" if progress is not None and progress < 0 else "indeterminate",
                       "prior_high": max((b.high for b in history), default=None) if len(history) >= p.minimum_history else None,
                       "prior_low": min((b.low for b in history), default=None) if len(history) >= p.minimum_history else None})
        tod_history[slot].append(bar.volume)
    return result
