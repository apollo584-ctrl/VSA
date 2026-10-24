"""Daily-bar pattern outcome study: what close-to-close price did after VSA signals. Descriptive history, not a forecast."""
import json
import math
import urllib.parse
from collections import defaultdict
from datetime import UTC, datetime
from statistics import mean, median, stdev
from zoneinfo import ZoneInfo

from app import patterns
from app.features import features
from app.models import Bar, Parameters
from app.providers import Fetch, ProviderUnavailable, SymbolNotFound, http_fetch
from app.price_action import detect as detect_price_action
from app.vsa import detect

NY = ZoneInfo("America/New_York")
YAHOO_DAILY_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=10y&includePrePost=false"
HORIZONS = (1, 5, 20)
MIN_CASES = 30
MIN_BREAKDOWN_CASES = 10
CUTOFF_FRACTION = 0.7
METHOD_NOTES = [
    "Close-to-close: a signal is known at the close of day D; the forward return is close[D+h] / close[D] - 1.",
    "Overlap dedupe: per symbol, concept and horizon only the first signal inside any h-day window is counted as an independent case.",
    "Baseline: the same horizon over every day of the same symbols and period; edge is hit rate minus baseline hit rate.",
    "Older/newer split uses one global cutoff date at 70% of all dates; 'holds' needs 30+ cases and a positive edge in both periods.",
    "Price patterns use daily bars only and are point-in-time: a pattern on day D uses only data up to the close of D.",
    "t-stat compares the mean return with the baseline mean (about 2 or more is stronger evidence); win/loss is the average favorable move divided by the average adverse move. Breakdowns split cases by trend and volume.",
    "Worst adverse move uses daily lows (strength) or highs (weakness) after D. Past frequencies, not a forecast.",
]


def fetch_daily(symbol: str, fetch: Fetch = http_fetch, now: datetime | None = None) -> list[Bar]:
    now = now or datetime.now(UTC)
    try:
        payload = json.loads(fetch(YAHOO_DAILY_URL.format(symbol=urllib.parse.quote(symbol, safe=""))))["chart"]
        if not isinstance(payload, dict):
            raise ValueError("chart must be an object")
        results = payload["result"]
        if results is None or results == []:
            error = payload.get("error")
            if isinstance(error, dict) and error.get("code") == "Not Found":
                raise SymbolNotFound(f"No market data found for symbol {symbol}")
            raise ValueError("missing chart result")
        if not isinstance(results, list) or len(results) != 1 or payload.get("error") is not None:
            raise ValueError("expected one successful chart result")
        result = results[0]
        returned = result["meta"]["symbol"]
        if not isinstance(returned, str) or returned.strip().upper() != symbol.strip().upper():
            raise ValueError("returned symbol does not match requested symbol")
        timestamps = result["timestamp"]
        if not isinstance(timestamps, list) or any(type(t) not in (int, float) or not math.isfinite(t) for t in timestamps):
            raise ValueError("timestamps must be finite numeric epoch seconds")
        quote = result["indicators"]["quote"][0]
        columns = [quote[name] for name in ("open", "high", "low", "close", "volume")]
        if any(not isinstance(c, list) or len(c) != len(timestamps) for c in columns):
            raise ValueError("OHLCV arrays must align with timestamps")
        if any(v is not None and (type(v) not in (int, float) or not math.isfinite(v)) for c in columns for v in c):
            raise ValueError("OHLCV values must be finite numbers or null")
    except SymbolNotFound:
        raise
    except (ValueError, KeyError, IndexError, TypeError, OverflowError, OSError) as exc:
        raise ProviderUnavailable("Market data provider returned an unreadable response") from exc
    bars: dict[str, Bar] = {}
    for t, *values in zip(timestamps, *columns):
        if any(v is None for v in values):
            continue
        day = datetime.fromtimestamp(t, UTC).astimezone(NY).date()
        available_at = datetime(day.year, day.month, day.day, 16, tzinfo=NY)
        o, h, l, c, v = values
        if available_at > now or min(o, h, l, c) <= 0 or v < 0 or h < max(o, c, l) or l > min(o, c, h):
            continue
        bars[day.isoformat()] = Bar(timestamp=datetime(day.year, day.month, day.day, tzinfo=NY), available_at=available_at,
                                    session=day.isoformat(), open=o, high=h, low=l, close=c, volume=v)
    if not bars:
        raise ProviderUnavailable(f"No completed daily bars are available for {symbol}")
    return [bars[d] for d in sorted(bars)]


def signals(bars: list[Bar], symbol: str = "", p: Parameters | None = None) -> list[dict]:
    p = p or Parameters()
    measurements = features(bars, p)
    index = {b.timestamp: i for i, b in enumerate(bars)}
    records = []

    def context(i: int) -> tuple[str, str, str]:
        f, bar = measurements[i], bars[i]
        trend = f["background"] if f["background"] in ("up", "down") else "flat"
        position = ("above" if bar.close > f["prior_high"] else "below" if bar.close < f["prior_low"] else "inside") \
            if f["prior_high"] is not None else "inside"
        rv = f["relative_volume"]
        bucket = "normal" if rv is None else "low" if rv <= p.low_volume else "high" if rv >= p.high_volume else "normal"
        return trend, position, bucket

    for e in [*detect(bars, measurements, p), *(e for e in detect_price_action(bars, measurements, p) if e.concept_id == "failed_breakout")]:
        if e.direction == "neutral":
            continue
        concept = e.concept_id
        if concept == "breakout":
            continue  # same event as breakout_20d_high / breakdown_20d_low
        concept = patterns.EVENT_CONCEPTS.get((concept, e.direction), concept)
        i = index[e.timestamp]
        trend, position, bucket = context(i)
        records.append({"symbol": symbol, "date": bars[i].session, "index": i, "concept": concept, "direction": e.direction,
                        "trend": trend, "range_position": position, "volume_bucket": bucket})
    found = patterns.detect_patterns(bars)
    for concept, flags in found.items():
        direction = patterns.PATTERNS[concept][0]
        for i in flags.nonzero()[0].tolist():
            trend, position, bucket = context(i)
            records.append({"symbol": symbol, "date": bars[i].session, "index": i, "concept": concept, "direction": direction,
                            "trend": trend, "range_position": position, "volume_bucket": bucket})
    gaps = found.get("gap_up")
    if gaps is not None:  # failed breakdown and gap up on the same bar
        records += [{**r, "concept": patterns.GAP_UP_COMBO} for r in records if r["concept"] == "failed_breakout_low" and gaps[r["index"]]]
    return records


def forward(bars: list[Bar], i: int, h: int, direction: str) -> dict | None:
    if i + h >= len(bars):
        return None
    base = bars[i].close
    ret = bars[i + h].close / base - 1
    window = bars[i + 1:i + h + 1]
    adverse = max(0.0, 1 - min(b.low for b in window) / base) if direction == "strength" else max(0.0, max(b.high for b in window) / base - 1)
    return {"return": ret, "favorable": ret > 0 if direction == "strength" else ret < 0, "worst_adverse": adverse}


def outcomes(bars: list[Bar], records: list[dict]) -> list[dict]:
    rows = []
    for r in records:
        for h in HORIZONS:
            result = forward(bars, r["index"], h, r["direction"])
            if result:
                rows.append({**r, "horizon": h, **result})
    return rows


def dedupe(rows: list[dict]) -> list[dict]:
    last: dict[tuple, int] = {}
    kept = []
    for r in sorted(rows, key=lambda r: (r["symbol"], r["concept"], r["horizon"], r["index"])):
        key = (r["symbol"], r["concept"], r["horizon"])
        if key in last and r["index"] - last[key] < r["horizon"]:
            continue
        last[key] = r["index"]
        kept.append(r)
    return kept


def baseline_rows(bars: list[Bar], symbol: str) -> list[dict]:
    rows = []
    for i in range(len(bars)):
        for h in HORIZONS:
            if i + h < len(bars):
                rows.append({"date": bars[i].session, "horizon": h, "return": bars[i + h].close / bars[i].close - 1})
    return rows


def t_stat(returns: list[float], base_mean: float) -> float | None:
    """t statistic of the mean return against the baseline mean; None when it cannot be computed."""
    if len(returns) < 2:
        return None
    sd = stdev(returns)
    return (mean(returns) - base_mean) / (sd / math.sqrt(len(returns))) if sd > 0 else None


def win_loss(rows: list[dict], direction: str) -> float | None:
    """Average favorable move divided by average adverse move (in the signal's direction); None if either side is empty."""
    moves = [r["return"] if direction == "strength" else -r["return"] for r in rows]
    wins, losses = [x for x in moves if x > 0], [-x for x in moves if x < 0]
    return mean(wins) / mean(losses) if wins and losses else None


def run_study(symbol_bars: dict[str, list[Bar]], now: datetime | None = None) -> dict:
    raw, base = [], []
    dates = set()
    for symbol, bars in symbol_bars.items():
        dates.update(b.session for b in bars)
        raw += outcomes(bars, signals(bars, symbol))
        base += baseline_rows(bars, symbol)
    ordered = sorted(dates)
    cutoff = ordered[int(len(ordered) * CUTOFF_FRACTION)] if ordered else None
    period = lambda d: "older" if d < cutoff else "newer"
    cases = dedupe(raw)
    n_raw = defaultdict(int)
    for r in raw:
        n_raw[(r["concept"], r["horizon"], period(r["date"]))] += 1
    grouped, direction_of = defaultdict(list), {}
    split = defaultdict(list)
    for r in cases:
        for dim in ("trend", "volume_bucket"):
            split[(r["concept"], r["horizon"], dim, r[dim])].append(r)
        grouped[(r["concept"], r["horizon"], period(r["date"]))].append(r)
        direction_of[r["concept"]] = r["direction"]
    base_group = defaultdict(list)
    for r in base:
        base_group[(r["horizon"], period(r["date"]))].append(r["return"])
    stats = []
    for (concept, h, per), rs in sorted(grouped.items()):
        direction = direction_of[concept]
        returns = [r["return"] for r in rs]
        base_returns = base_group[(h, per)]
        base_hit = sum(1 for x in base_returns if (x > 0 if direction == "strength" else x < 0)) / len(base_returns)
        hit = sum(r["favorable"] for r in rs) / len(rs)
        stats.append({"concept": concept, "direction": direction, "horizon": h, "period": per, "n_cases": len(rs),
                      "n_raw": n_raw[(concept, h, per)], "hit_rate": hit, "mean_return": mean(returns),
                      "median_return": median(returns), "avg_worst_adverse": mean(r["worst_adverse"] for r in rs),
                      "baseline_hit_rate": base_hit, "baseline_mean_return": mean(base_returns), "edge": hit - base_hit,
                      "t_stat": t_stat(returns, mean(base_returns)), "win_loss_ratio": win_loss(rs, direction)})
    by_key = {(s["concept"], s["horizon"], s["period"]): s for s in stats}
    summary = []
    for concept, h in sorted({(s["concept"], s["horizon"]) for s in stats}):
        old, new = by_key.get((concept, h, "older")), by_key.get((concept, h, "newer"))
        holds = bool(old and new and old["n_cases"] >= MIN_CASES and new["n_cases"] >= MIN_CASES
                     and old["edge"] > 0 and new["edge"] > 0)
        summary.append({"concept": concept, "horizon": h, "holds": holds})
    holds_map = {(s["concept"], s["horizon"]): s["holds"] for s in summary}
    for s in stats:
        s["holds"] = holds_map[(s["concept"], s["horizon"])]
    all_base = defaultdict(list)
    for (h, _), xs in base_group.items():
        all_base[h] += xs
    breakdowns = []
    for (concept, h, dim, value), rs in sorted(split.items()):
        if len(rs) < MIN_BREAKDOWN_CASES:
            continue
        direction = direction_of[concept]
        base_hit = sum(1 for x in all_base[h] if (x > 0 if direction == "strength" else x < 0)) / len(all_base[h])
        hit = sum(r["favorable"] for r in rs) / len(rs)
        breakdowns.append({"concept": concept, "horizon": h, "dimension": dim, "value": value, "n_cases": len(rs),
                           "hit_rate": hit, "edge": hit - base_hit})
    return {"generated_at": (now or datetime.now(UTC)).isoformat(), "symbols_used": sorted(symbol_bars),
            "date_range": {"start": ordered[0] if ordered else None, "end": ordered[-1] if ordered else None},
            "cutoff_date": cutoff, "horizons": list(HORIZONS), "min_cases": MIN_CASES,
            "stats": stats, "holds": summary, "breakdowns": breakdowns,
            "concepts": patterns.concept_info(), "method_notes": METHOD_NOTES}
