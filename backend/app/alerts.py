"""Daily alerts from the pattern study and their after-the-fact scoring. Pure functions, no I/O; descriptive history, not a forecast."""
from collections import defaultdict
from datetime import date
from statistics import mean

from app import outcomes
from app.models import Bar

ROUND_TRIP_COST = 0.001


def build_alerts(symbol_bars: dict[str, list[Bar]], study: dict, session: str) -> list[dict]:
    holding = {h["concept"] for h in study["holds"] if h["holds"]}
    alerts = []
    for symbol, bars in sorted(symbol_bars.items()):
        known = [b for b in bars if b.session <= session]
        for s in outcomes.signals(known, symbol):
            if s["date"] != session or s["concept"] not in holding:
                continue
            alerts.append({"symbol": symbol, "session_date": session, "concept": s["concept"], "direction": s["direction"],
                           "entry_close": known[s["index"]].close, "study_generated_at": study["generated_at"],
                           **study_context(study, s["concept"])})
    return alerts


def study_context(study: dict, concept: str) -> dict:
    """Horizons where the concept holds up, with the study's newer-period hit rate and edge for each."""
    horizons = sorted(h["horizon"] for h in study["holds"] if h["holds"] and h["concept"] == concept)
    newer = {s["horizon"]: s for s in study["stats"] if s["period"] == "newer" and s["concept"] == concept}
    return {"holding_horizons": horizons,
            "study_newer": [{"horizon": h, "edge": newer[h]["edge"], "hit_rate": newer[h]["hit_rate"]} for h in horizons if h in newer]}


def score(alert: dict, bars: list[Bar]) -> list[dict]:
    i = next((k for k, b in enumerate(bars) if b.session == alert["session_date"]), None)
    if i is None:
        return []
    rows = []
    for h in outcomes.HORIZONS:
        r = outcomes.forward(bars, i, h, alert["direction"])
        if r:
            rows.append({"horizon": h, **r})
    return rows


def _day_index(session: str) -> int:
    """Approximate trading-day number (weekdays only) for overlap dedupe when no bar index is stored."""
    n = date.fromisoformat(session).toordinal()
    return n // 7 * 5 + min(n % 7, 5)


def track_record(alerts_with_outcomes: list[dict], baseline_returns: dict[int, list[float]]) -> list[dict]:
    """Rows need symbol, concept, direction, session_date, horizon, return, favorable; optional index (bar number)."""
    rows = [{**r, "index": r["index"] if r.get("index") is not None else _day_index(r["session_date"])} for r in alerts_with_outcomes]
    groups = defaultdict(list)
    for r in outcomes.dedupe(rows):
        groups[(r["concept"], r["horizon"])].append(r)
    result = []
    for (concept, h), rs in sorted(groups.items()):
        direction = rs[0]["direction"]
        adjusted = [r["return"] if direction == "strength" else -r["return"] for r in rs]
        base = baseline_returns.get(h) or []
        base_hit = sum(1 for x in base if (x > 0 if direction == "strength" else x < 0)) / len(base) if base else None
        enough = len(rs) >= outcomes.MIN_CASES
        result.append({"concept": concept, "direction": direction, "horizon": h, "n": len(rs),
                       "hit_rate": sum(r["favorable"] for r in rs) / len(rs), "mean_return": mean(adjusted),
                       "mean_return_net": mean(adjusted) - ROUND_TRIP_COST, "baseline_hit_rate": base_hit,
                       "verdict": "enough cases" if enough else "too few cases yet"})
    return result
