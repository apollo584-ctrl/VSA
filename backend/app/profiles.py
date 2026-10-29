"""Range occupancy and uniform bar-volume estimates; never trade-at-price."""
from decimal import Decimal, ROUND_FLOOR

import numpy as np
import pandas as pd

from app import bins as tickbins, markets
from app.models import Bar, Distribution, Parameters, Profile, Shape, Source


class ProfileLimitError(ValueError):
    """A valid price range exceeds the configured profile resource bound."""


def shape(weights: np.ndarray, bars: list[Bar], p: Parameters) -> Shape:
    total = float(weights.sum())
    features = {"total": total, "weighted_skewness": 0.0, "mode_count": 0.0,
                "directional_progress": 0.0, "concentration": 0.0}
    label = "unclassified"
    alternatives = []
    if total > 0:
        x = np.arange(len(weights), dtype=float)
        mean = float(np.dot(x, weights) / total)
        variance = float(np.dot((x - mean) ** 2, weights) / total)
        skew = float(np.dot((x - mean) ** 3, weights) / total / variance ** 1.5) if variance else 0.0
        nodes = peak_indices(weights, p)
        price_range = max(b.high for b in bars) - min(b.low for b in bars)
        progress = (bars[-1].close - bars[0].open) / price_range if price_range else 0.0
        features.update(weighted_skewness=skew, mode_count=float(len(nodes)),
                        directional_progress=progress, concentration=float(weights.max() / total))
        if len(bars) < p.minimum_history or variance == 0:
            label = "unclassified"
        elif len(nodes) > 2:
            label = "multi_modal"
        elif len(nodes) == 2:
            label = "B_double_distribution"
        elif abs(progress) >= p.trend_progress:
            label = "upward_elongated" if progress > 0 else "downward_elongated"
            alternatives = ["P_upper_heavy" if skew < 0 else "b_lower_heavy"]
        elif skew <= -p.shape_skew:
            label = "P_upper_heavy"
            alternatives = ["D_balanced"]
        elif skew >= p.shape_skew:
            label = "b_lower_heavy"
            alternatives = ["D_balanced"]
        else:
            label = "D_balanced"
            alternatives = ["unclassified"]
    interpretations = {
        "P_upper_heavy": "Activity concentrated higher; covering or higher-price acceptance are possible, unproven explanations.",
        "b_lower_heavy": "Activity concentrated lower; liquidation or lower-price acceptance are possible, unproven explanations.",
        "D_balanced": "Distribution is consistent with two-sided auction activity.",
        "B_double_distribution": "Separated concentrations may indicate a transition between value regions.",
        "multi_modal": "Several concentrations may represent multiple auction regions.",
        "upward_elongated": "Net upward progress accompanies the observed distribution.",
        "downward_elongated": "Net downward progress accompanies the observed distribution.",
        "unclassified": "Insufficient or degenerate distribution; no defensible shape classification."}
    return Shape(classification=label, ambiguity="high", features=features, alternatives=alternatives,
                 interpretation=interpretations[label], limitations=[
                     "Heuristic classification, not a calibrated probability or proof of participant intent.",
                     "Bin size, estimated occupancy, incomplete sessions and composite mixing can change the result."])


def peak_indices(weights: np.ndarray, p: Parameters) -> list[int]:
    if weights.sum() <= 0:
        return []
    candidates = []
    # Collapse flat maxima; require a separating valley, not every equal bin as a mode.
    for i, weight in enumerate(weights):
        left = weights[i - 1] if i else -1
        right = weights[i + 1] if i + 1 < len(weights) else -1
        if weight >= weights.max() * p.node_fraction and weight > left and weight >= right:
            candidates.append(i)
    selected = []
    for index in sorted(candidates, key=lambda i: (-weights[i], i)):
        if all(abs(index - old) >= p.node_separation_bins and
               weights[min(index, old):max(index, old) + 1].min() <=
               min(weights[index], weights[old]) * p.valley_fraction for old in selected):
            selected.append(index)
    return sorted(selected)


def value_area_indices(weights, fraction):
    total = float(weights.sum())
    # Ties: lower price. Grow contiguously from POC; equal neighbours choose lower.
    poc = int(np.argmax(weights))
    low = high = poc
    enclosed = float(weights[poc])
    while enclosed < total * fraction and (low > 0 or high < len(weights) - 1):
        left = weights[low - 1] if low > 0 else -1
        right = weights[high + 1] if high + 1 < len(weights) else -1
        if left >= right:
            low -= 1
            enclosed += float(weights[low])
        else:
            high += 1
            enclosed += float(weights[high])
    return poc, low, high, enclosed


def distribution(weights, centers, bars, p, method, bounds=None):
    """bounds: optional exact (lower, upper) float edges per bin (grain), instead of centers -/+ bin_size / 2."""
    total = float(weights.sum())
    if total <= 0:
        return Distribution(method=method, counts=weights.tolist(), poc=None, vah=None, val=None,
                            achieved_value_fraction=None, shape=shape(weights, bars, p))
    poc, low, high, enclosed = value_area_indices(weights, p.value_area_fraction)
    val = float(bounds[0][low]) if bounds else float(centers[low] - p.bin_size / 2)
    vah = float(bounds[1][high]) if bounds else float(centers[high] + p.bin_size / 2)
    return Distribution(method=method, counts=weights.tolist(), poc=float(centers[poc]),
                        val=val, vah=vah,
                        achieved_value_fraction=enclosed / total, shape=shape(weights, bars, p))


GRAIN_VOLUME_NOTE = ("Intraday volume is partial (estimated); volume per bin is spread evenly across the bins "
                     "each bar touched, not measured at price.")


def is_grain_intraday(source: Source) -> bool:
    return source.market == "cbot_grains" and source.timeframe_minutes in markets.GRAIN_STEP_MINUTES


def _grain_bins(source: Source, p: Parameters):
    """(bin size, index function) for exact tick-based grain bins."""
    root = markets.contract_parts(source.contract)[0]
    tick = markets.get_market("cbot_grains").tick_size_for(root)
    if tick is None:
        raise ValueError(f"No tick size known for {root}")
    size = Decimal(str(p.bin_size))
    if size <= 0 or size % tick != 0:
        raise ValueError(f"bin_size must be a whole multiple of the tick size {tick}")
    return size, lambda price: tickbins.bin_index(tickbins.snap_to_tick(price, tick)[0], size)


def _grain_period(timestamp) -> int:
    floored = pd.Timestamp(timestamp).tz_convert("America/Chicago").floor("30min")
    return markets.tpo_period(floored.to_pydatetime(), 30)


def profile(bars: list[Bar], source: Source, p: Parameters, scope="session") -> Profile:
    grain = is_grain_intraday(source)
    if grain and p.tpo_minutes != 30:
        raise ValueError("Grain TPO periods are 30 minutes")
    if p.tpo_minutes < source.timeframe_minutes or p.tpo_minutes % source.timeframe_minutes:
        raise ValueError("TPO interval must be a multiple of the bar timeframe and at least as large")
    def bin_index(price):
        if grain:
            return grain_index(price)
        return int((Decimal(str(price)) / Decimal(str(p.bin_size))).to_integral_value(rounding=ROUND_FLOOR))

    if grain:
        grain_size, grain_index = _grain_bins(source, p)
    lower_index = bin_index(min(b.low for b in bars))
    upper_index = bin_index(max(b.high for b in bars))
    if upper_index - lower_index + 1 > 2000:
        raise ProfileLimitError("Profile exceeds 2000 bins; increase bin_size")
    if grain:
        edges = tickbins.bin_edges(lower_index, upper_index, grain_size)
        lowers = np.array([float(e) for e in edges])
        centers = np.array([float(e + grain_size / 2) for e in edges])
        bounds = (lowers, np.array([float(e + grain_size) for e in edges]))
    else:
        bounds = None
        lowers = np.arange(lower_index, upper_index + 1, dtype=float) * p.bin_size
        centers = lowers + p.bin_size / 2
    volumes = np.zeros(len(lowers))
    occupancy: dict[tuple[str, int], set[int]] = {}
    for bar in bars:
        lo = max(0, bin_index(bar.low) - lower_index)
        hi = min(len(lowers) - 1, bin_index(bar.high) - lower_index)
        bins = list(range(lo, hi + 1))
        volumes[bins] += bar.volume / len(bins)
        if grain:
            period = _grain_period(bar.timestamp)
        else:
            local = pd.Timestamp(bar.timestamp).tz_convert("America/New_York")
            anchor = 570 if source.session_mode == "regular" else 240
            period = (local.hour * 60 + local.minute - anchor) // p.tpo_minutes
        occupancy.setdefault((bar.session, period), set()).update(bins)
    tpos = np.zeros(len(lowers))
    for bins in occupancy.values():
        tpos[list(bins)] += 1
    tpo = distribution(tpos, centers, bars, p, "estimated_tpo_range_occupancy", bounds)
    volume = distribution(volumes, centers, bars, p, "estimated_uniform_volume_per_touched_bin", bounds)
    nodes = peak_indices(volumes, p)
    valleys = [i for i in range(1, len(volumes) - 1)
               if volumes.max() > 0 and volumes[i] <= volumes.max() * p.valley_fraction
               and volumes[i] < volumes[i - 1] and volumes[i] <= volumes[i + 1]]
    ib = {"high": None, "low": None, "complete": False, "method": "first_regular_session_minutes"}
    extension = {"above": None, "below": None}
    if grain:
        ib = {"high": None, "low": None, "complete": False, "method": "not computed for grain sessions"}
    if scope == "session" and source.session_mode == "regular" and not grain:
        start = pd.Timestamp(bars[0].session, tz="America/New_York") + pd.Timedelta(minutes=570)
        cutoff = start + pd.Timedelta(minutes=p.initial_balance_minutes)
        subset = [b for b in bars if pd.Timestamp(b.available_at) <= cutoff]
        expected = p.initial_balance_minutes // source.timeframe_minutes
        complete = p.initial_balance_minutes % source.timeframe_minutes == 0 and len(subset) == expected
        if subset:
            ib.update(high=max(b.high for b in subset), low=min(b.low for b in subset), complete=complete)
            if complete:
                extension = {"above": max(0.0, max(b.high for b in bars) - ib["high"]),
                             "below": max(0.0, ib["low"] - min(b.low for b in bars))}
    notes = ["OHLCV does not reveal exact volume-at-price, intrabar path or order flow.",
             "Single prints are estimated occupied bins with exactly one TPO period.",
             "Inclusive range endpoints; bin centers represent touched intervals, not actual trade prices."]
    if grain:
        notes.append(GRAIN_VOLUME_NOTE)
    return Profile(id=f"profile:{scope}:{bars[0].session}:{bars[-1].session}",
                   session=bars[-1].session if scope == "session" else f"{bars[0].session}/{bars[-1].session}",
                   scope=scope, as_of=bars[-1].available_at, bin_size=p.bin_size,
                   price_bin_lower=lowers.tolist(), price_bin_center=centers.tolist(), tpo=tpo, volume=volume,
                   hvns=[float(centers[i]) for i in nodes], lvns=[float(centers[i]) for i in valleys],
                   single_print_bins=[float(centers[i]) for i in np.flatnonzero(tpos == 1)],
                   initial_balance=ib, range_extension=extension,
                   extremes={"excess": "indeterminate_from_OHLCV", "poor_extremes": "indeterminate_from_OHLCV"},
                   limitations=notes)


def profiles(bars: list[Bar], source: Source, p: Parameters):
    grouped: dict[str, list[Bar]] = {}
    for bar in bars:
        grouped.setdefault(bar.session, []).append(bar)
    result = [profile(group, source, p) for group in grouped.values()]
    return result
