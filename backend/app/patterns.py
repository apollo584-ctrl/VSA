"""Free daily-bar price patterns for the outcome study. Pure, point-in-time: an event at bar i uses only bars 0..i.

Descriptive history, not a forecast. Each pattern has a direction (strength or weakness), a group and plain-English text."""
import numpy as np

from app.models import Bar

GAP = 0.01
BREAKOUT_BARS = 20
YEAR_BARS = 252
NR_BARS = 7
RSI_LOW, RSI_HIGH = 10.0, 90.0

# id -> (direction, group, label, description)
PATTERNS: dict[str, tuple[str, str, str, str]] = {
    "inside_day_up": ("strength", "price", "Inside day, closed up", "The day's range sat inside the prior day's range and the day closed above its open: a pause with a firm close."),
    "inside_day_down": ("weakness", "price", "Inside day, closed down", "The day's range sat inside the prior day's range and the day closed below its open: a pause with a soft close."),
    "outside_day_up": ("strength", "price", "Outside day, closed up", "The day's range swallowed the prior day's range and closed above its open."),
    "outside_day_down": ("weakness", "price", "Outside day, closed down", "The day's range swallowed the prior day's range and closed below its open."),
    "gap_up": ("strength", "price", "Gap up", "The day opened at least 1% above the prior close."),
    "gap_down": ("weakness", "price", "Gap down", "The day opened at least 1% below the prior close."),
    "breakout_20d_high": ("strength", "price", "20-day high breakout", "Closed above the highest high of the prior 20 days."),
    "breakdown_20d_low": ("weakness", "price", "20-day low breakdown", "Closed below the lowest low of the prior 20 days."),
    "new_52w_high": ("strength", "price", "New 52-week high", "Closed above the highest high of the prior 252 days."),
    "new_52w_low": ("weakness", "price", "New 52-week low", "Closed below the lowest low of the prior 252 days."),
    "nr7_up": ("strength", "price", "Narrowest range of 7, closed up", "The day's high-low range was the smallest of the last 7 days and the day closed above its open."),
    "nr7_down": ("weakness", "price", "Narrowest range of 7, closed down", "The day's high-low range was the smallest of the last 7 days and the day closed below its open."),
    "three_down_days": ("strength", "momentum", "Three down days (oversold bounce)", "Three lower closes in a row; looks at whether prices bounce afterwards."),
    "three_up_days": ("weakness", "momentum", "Three up days (stretched)", "Three higher closes in a row; looks at whether prices fade afterwards."),
    "rsi2_oversold": ("strength", "momentum", "2-day RSI below 10", "Very short-term oversold: the 2-day RSI (simple averages) closed below 10."),
    "rsi2_overbought": ("weakness", "momentum", "2-day RSI above 90", "Very short-term overbought: the 2-day RSI (simple averages) closed above 90."),
    "close_above_200ma_cross": ("strength", "momentum", "Close crosses above 200-day average", "Closed above the 200-day average after closing at or below it the day before."),
    "close_below_200ma_cross": ("weakness", "momentum", "Close crosses below 200-day average", "Closed below the 200-day average after closing at or above it the day before."),
    "pullback_to_50ma_in_uptrend": ("strength", "momentum", "Pullback to rising 50-day average", "In an uptrend (50-day above 200-day and rising) the low touched the 50-day average and the day closed back above it."),
    # Watch patterns: the only combinations that stayed positive after a stricter 10-year S&P 500 re-test (market-adjusted, counted by month). Small edges; still a past-frequency study.
    "gap_up_weak_close": ("strength", "price", "Gap up, closed near the low", "The day opened at least 1% above the prior close but closed in the lowest fifth of its range. Watch pattern: it held up in a stricter re-test."),
    "gap_up_oversold": ("strength", "momentum", "Gap up while 2-day RSI below 10", "The day opened at least 1% above the prior close and the 2-day RSI closed below 10. Watch pattern: it held up in a stricter re-test."),
}


# Directional completed-bar events from price_action.py, split by direction so each id has one direction.
# (price_action's "breakout" duplicates breakout_20d_high / breakdown_20d_low, so it is not added again.)
EVENT_CONCEPTS: dict[tuple[str, str], str] = {
    ("failed_breakout", "weakness"): "failed_breakout_high",
    ("failed_breakout", "strength"): "failed_breakout_low",
}
EVENT_PATTERNS: dict[str, tuple[str, str, str, str]] = {
    "failed_breakout_high": ("weakness", "price", "Failed breakout above range", "The high pushed above the prior range high but the day closed back below it: the higher prices were rejected."),
    "failed_breakout_low": ("strength", "price", "Failed breakdown below range", "The low pushed below the prior range low but the day closed back above it: the lower prices were rejected."),
    "failed_breakdown_gap_up": ("strength", "price", "Failed breakdown with a gap up", "A failed breakdown below the range (see above) on a day that also opened at least 1% above the prior close. Watch pattern: it held up in a stricter re-test."),
}
GAP_UP_COMBO = "failed_breakdown_gap_up"  # failed_breakout_low and gap_up on the same bar; built in outcomes.signals
IBS_LOW = 0.2


def concept_info() -> dict[str, dict]:
    return {k: {"direction": d, "group": g, "label": label, "description": text} for k, (d, g, label, text) in {**PATTERNS, **EVENT_PATTERNS}.items()}


def _sma(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if len(x) >= n:
        c = np.concatenate([[0.0], np.cumsum(x)])
        out[n - 1:] = (c[n:] - c[:-n]) / n
    return out


def _rolling(x: np.ndarray, n: int, fn) -> np.ndarray:
    """Value of fn over the n bars BEFORE each bar (excludes the bar itself); NaN until n bars exist."""
    out = np.full(len(x), np.nan)
    if len(x) > n:
        view = np.lib.stride_tricks.sliding_window_view(x, n)  # window k covers x[k:k+n]
        out[n:] = fn(view[:-1], axis=1)
    return out


def _shift(x: np.ndarray, k: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if len(x) > k:
        out[k:] = x[:-k]
    return out


def detect_patterns(bars: list[Bar]) -> dict[str, np.ndarray]:
    """Boolean array per pattern id; element i is True if the pattern completed at the close of bar i."""
    n = len(bars)
    o = np.array([b.open for b in bars], dtype=float)
    h = np.array([b.high for b in bars], dtype=float)
    low = np.array([b.low for b in bars], dtype=float)
    c = np.array([b.close for b in bars], dtype=float)
    pc, ph, pl = _shift(c, 1), _shift(h, 1), _shift(low, 1)
    up, down = c > o, c < o
    out: dict[str, np.ndarray] = {}
    with np.errstate(invalid="ignore", divide="ignore"):
        inside = (h < ph) & (low > pl)
        outside = (h > ph) & (low < pl)
        out["inside_day_up"], out["inside_day_down"] = inside & up, inside & down
        out["outside_day_up"], out["outside_day_down"] = outside & up, outside & down
        out["gap_up"], out["gap_down"] = o >= pc * (1 + GAP), o <= pc * (1 - GAP)
        out["breakout_20d_high"] = c > _rolling(h, BREAKOUT_BARS, np.max)
        out["breakdown_20d_low"] = c < _rolling(low, BREAKOUT_BARS, np.min)
        out["new_52w_high"] = c > _rolling(h, YEAR_BARS, np.max)
        out["new_52w_low"] = c < _rolling(low, YEAR_BARS, np.min)
        rng = h - low
        narrow = np.full(n, False)
        if n >= NR_BARS:
            narrow[NR_BARS - 1:] = rng[NR_BARS - 1:] <= np.lib.stride_tricks.sliding_window_view(rng, NR_BARS).min(axis=1)
        out["nr7_up"], out["nr7_down"] = narrow & up, narrow & down
        d1, d2 = c - pc, _shift(c, 1) - _shift(c, 2)
        d3 = _shift(c, 2) - _shift(c, 3)
        out["three_down_days"], out["three_up_days"] = (d1 < 0) & (d2 < 0) & (d3 < 0), (d1 > 0) & (d2 > 0) & (d3 > 0)
        gain, loss = np.where(d1 > 0, d1, 0.0), np.where(d1 < 0, -d1, 0.0)
        if n:
            gain[0] = loss[0] = np.nan
        ag, al = (gain + _shift(gain, 1)) / 2, (loss + _shift(loss, 1)) / 2
        rsi = np.where(al == 0, np.where(ag == 0, 50.0, 100.0), 100 - 100 / (1 + ag / np.where(al == 0, 1, al)))
        rsi = np.where(np.isnan(ag) | np.isnan(al), np.nan, rsi)
        out["rsi2_oversold"], out["rsi2_overbought"] = rsi < RSI_LOW, rsi > RSI_HIGH
        out["gap_up_oversold"] = out["gap_up"] & out["rsi2_oversold"]
        out["gap_up_weak_close"] = out["gap_up"] & (rng > 0) & ((c - low) / np.where(rng > 0, rng, 1) < IBS_LOW)
        ma200, ma50 = _sma(c, 200), _sma(c, 50)
        p200 = _shift(ma200, 1)
        out["close_above_200ma_cross"] = (c > ma200) & (pc <= p200)
        out["close_below_200ma_cross"] = (c < ma200) & (pc >= p200)
        out["pullback_to_50ma_in_uptrend"] = (ma50 > ma200) & (ma50 > _shift(ma50, 10)) & (low <= ma50) & (c > ma50)
    return {k: np.nan_to_num(v, nan=0).astype(bool) if v.dtype != bool else v for k, v in out.items()}
