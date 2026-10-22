"""Setup A checker (VSA Trading Plan section 2): acceptance above the prior session's VAH, then a retest.

A manual research checklist for paper trading. It reads completed bars only, never looks ahead of a bar it is judging and
never places orders. The first attempt of the session is final: a cancelled or expired attempt is not restarted.
"""
from datetime import UTC, datetime

import pandas as pd

from app import value_location
from app.data import calendar, ingest, quality
from app.interpretation import interpret
from app.models import AnalyzeRequest, Bar, Dataset, Parameters
from app.profiles import profiles
from app.providers import Fetch, ProviderUnavailable, YahooChartProvider, http_fetch

ACCEPT_CLOSES = 3
RETEST_BARS = 5
WINDOW_START, WINDOW_END = 10 * 60, 15 * 60  # minutes after midnight, New York
TICK = 0.01
MAX_CHASE = 0.25
TARGET_R = 2.0
NY = "America/New_York"


def _minutes(stamp) -> int:
    t = pd.Timestamp(stamp).tz_convert(NY)
    return t.hour * 60 + t.minute


def _in_window(bar: Bar, step: int) -> bool:
    """A bar is inside the window when it starts at or after 10:00 and has closed by 15:00."""
    start = _minutes(bar.timestamp)
    return start >= WINDOW_START and start + step <= WINDOW_END


def _result(symbol, stage, explanation, **extra):
    base = {"symbol": symbol, "stage": stage, "acceptance_closes": 0, "retest_bars_left": None, "prior_vah": None, "prior_val": None,
            "prior_poc": None, "last_bar_time": None, "last_close": None, "retest": None, "entry_reference": None, "stop": None,
            "target": None, "contradiction": False, "no_trade_reasons": [], "explanation": explanation}
    base.update(extra)
    return base


def no_data(symbol: str, reason: str) -> dict:
    return _result(symbol, "no_data", reason, no_trade_reasons=[reason])


def evaluate(dataset: Dataset, bars: list[Bar]) -> dict:
    """Setup A state for the last session in `bars`. Pure: the same bars always give the same answer."""
    symbol = dataset.source.instrument
    bars = sorted(bars, key=lambda b: b.timestamp)
    if not bars:
        return no_data(symbol, "No completed bars are available.")
    step = dataset.source.timeframe_minutes
    session = bars[-1].session
    last = bars[-1]
    common = {"last_bar_time": last.timestamp.isoformat(), "last_close": last.close}
    cal = calendar(bars[0].session, session)
    if not cal.is_session(session):
        return _result(symbol, "not_eligible", f"{session} is not a regular trading session.", **common,
                       no_trade_reasons=["Not a regular trading session."])
    close_local = pd.Timestamp(cal.session_close(session)).tz_convert(NY)
    if (close_local.hour, close_local.minute) != (16, 0):
        return _result(symbol, "not_eligible", "Early-close day: the plan does not cover shortened sessions.", **common,
                       no_trade_reasons=["Early-close session: Setup A is not evaluated."])
    p = Parameters()
    # The prior reference is built from earlier sessions only, so nothing later today can change it.
    earlier = [b for b in bars if b.session != session]
    if not earlier:
        return _result(symbol, "not_eligible", "No usable prior-session reference: no prior session in the data.", **common,
                       no_trade_reasons=["Unusable prior-session reference."])
    q = quality(earlier, dataset.source, p)
    try:
        session_profiles = profiles(earlier, dataset.source, p)
    except ValueError as exc:
        return _result(symbol, "not_eligible", f"Prior-session profile could not be built: {exc}", **common,
                       no_trade_reasons=["Prior-session reference is unusable."])
    complete = {item.session for item in session_profiles} - set(q.incomplete_sessions)
    table = value_location.reference_table(bars, session_profiles, complete)
    reference, reason = table[session]
    if reference is None:
        text = {"no_prior_session": "no prior session in the data", "prior_session_not_adjacent": "the prior session is not adjacent",
                "prior_session_incomplete": "the prior session has missing bars", "prior_value_area_unavailable": "the prior value area is unavailable"}
        return _result(symbol, "not_eligible", f"No usable prior-session reference: {text.get(reason, reason)}.", **common,
                       no_trade_reasons=["Unusable prior-session reference."])
    vah, val, poc = reference.volume.vah, reference.volume.val, reference.volume.poc
    levels = {"prior_vah": vah, "prior_val": val, "prior_poc": poc}
    today = [b for b in bars if b.session == session]
    reasons: list[str] = []
    missing = _result(symbol, "not_eligible", "Bars are missing from today's session, so the setup window cannot be verified.", **common, **levels,
                      no_trade_reasons=["Data-quality warning: missing bars in today's session."])
    if _minutes(today[0].timestamp) != 9 * 60 + 30:
        return missing

    def gap_before(i: int) -> bool:
        return i > 0 and pd.Timestamp(today[i].timestamp) - pd.Timestamp(today[i - 1].timestamp) != pd.Timedelta(minutes=step)

    count = 0
    stage = "waiting"
    retest_index = None
    watch_left = RETEST_BARS
    end = len(today) - 1  # last bar the decision depends on; later bars never change it
    for i, bar in enumerate(today):
        # Only bars up to the decision are checked for gaps, so a later omission cannot rewrite an earlier result.
        if gap_before(i):
            return missing
        if stage in ("waiting", "counting"):
            if not _in_window(bar, step):
                continue
            if bar.close > vah:
                count += 1
                stage = "counting"
                if count >= ACCEPT_CLOSES:
                    stage, watch_left = "retest_watch", RETEST_BARS
            else:
                count, stage = 0, "waiting"
        elif stage == "retest_watch":
            if bar.low <= vah and bar.low > val and bar.close > vah:
                stage, retest_index = "triggered", i
                end = min(i + 1, len(today) - 1)  # the entry bar follows the retest
                if end > i and gap_before(end):
                    return missing
                break
            if bar.close <= vah:
                stage, end = "cancelled", i
                break
            watch_left -= 1
            if watch_left == 0:
                stage, end = "expired", i
                break
    decided = today[:end + 1]
    if quality(earlier + decided, dataset.source, p).split_suspected:
        return _result(symbol, "not_eligible", "Possible split or large price discontinuity in the data.", **common, **levels,
                       no_trade_reasons=["Data-quality warning: possible split or large price discontinuity."])
    if any(b.volume == 0 for b in decided):
        reasons.append("Data-quality warning: zero-volume bars in today's session.")
    out = _result(symbol, stage, "", acceptance_closes=count, **common, **levels)
    if stage == "retest_watch":
        out["retest_bars_left"] = watch_left
    if stage in ("waiting", "counting", "retest_watch") and _minutes(last.timestamp) + step > WINDOW_END:
        reasons.append("Outside the 10:00-15:00 New York entry window.")
    elif stage in ("waiting", "counting") and _minutes(last.timestamp) + step <= WINDOW_START:
        reasons.append("Before the 10:00 New York entry window opens.")
    if stage == "triggered":
        retest = today[retest_index]
        following = today[retest_index + 1] if retest_index + 1 < len(today) else None
        stop = round(retest.low - TICK, 2)
        entry = following.open if following else None
        out["retest"] = {"time": retest.timestamp.isoformat(), "open": retest.open, "high": retest.high, "low": retest.low, "close": retest.close}
        out["stop"] = stop
        if not _in_window(retest, step):
            reasons.append("The retest bar is outside the 10:00-15:00 New York entry window.")
        if entry is not None:
            risk = entry - stop
            out["entry_reference"] = entry
            if risk <= 0:
                reasons.append("Entry is at or below the stop.")
            else:
                out["target"] = round(entry + TARGET_R * risk, 2)
                if entry > retest.close + MAX_CHASE * risk:
                    reasons.append("Entry is more than 0.25 times the stop distance above the retest close.")
            if not _in_window(following, step):
                reasons.append("The entry bar is outside the 10:00-15:00 New York entry window.")
        try:
            analysis = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, as_of=retest.available_at, persist=False))
            out["contradiction"] = bool(analysis.contradicting_evidence)
            if out["contradiction"]:
                reasons.append("The engine reports contradicting evidence at the retest close.")
        except ValueError as exc:
            reasons.append(f"The engine analysis could not be run at the retest close: {exc}")
    out["no_trade_reasons"] = reasons
    out["explanation"] = _explain(out, vah)
    return out


def _explain(out: dict, vah: float) -> str:
    stage = out["stage"]
    if stage == "waiting":
        return f"Waiting for three completed 5-minute closes above the prior value area high ({vah:.2f}) inside the entry window."
    if stage == "counting":
        return f"{out['acceptance_closes']} of 3 closes above the prior value area high ({vah:.2f}); a close at or below it restarts the count."
    if stage == "retest_watch":
        return (f"Accepted above {vah:.2f}. Watching up to {out['retest_bars_left']} more bar(s) for a retest: low at or below it, "
                f"low above the prior VAL, close back above it.")
    if stage == "triggered":
        base = "Retest found: low touched the prior VAH, held above the prior VAL and closed back above the VAH."
        return base + (" Paper entry reference is the next bar's open." if out["entry_reference"] is not None
                       else " The next bar has not completed yet, so there is no entry reference.")
    if stage == "cancelled":
        return f"Cancelled: a bar closed at or below the prior VAH ({vah:.2f}) before a qualifying retest."
    return "Expired: no qualifying retest within five bars, so no trade."


STALE_AFTER = pd.Timedelta(minutes=15)


def fresh(result: dict, bars: list[Bar], now: datetime) -> dict:
    """Live-check boundary: only today's session counts, and bars must be recent while the market is open."""
    if not bars:
        return result
    last = max(bars, key=lambda b: b.timestamp)
    today = pd.Timestamp(now).tz_convert(NY).date().isoformat()
    if last.session != today:
        return _result(result["symbol"], "not_eligible",
                       f"The latest bars are from {last.session}, not today ({today}). Today's session has not started or the data is stale.",
                       last_bar_time=result["last_bar_time"], last_close=result["last_close"],
                       no_trade_reasons=["No bars from today's session yet."])
    cal = calendar(today, today)
    if cal.is_session(today) and pd.Timestamp(now) < pd.Timestamp(cal.session_close(today)) \
            and pd.Timestamp(now) - pd.Timestamp(last.available_at) > STALE_AFTER:
        result["no_trade_reasons"] = [*result["no_trade_reasons"], "Data is stale: the newest bar is more than 15 minutes old."]
    return result


def check_symbol(symbol: str, fetch: Fetch = http_fetch, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    try:
        source, raw = YahooChartProvider(symbol, 5, "5d", fetch=fetch).read()
        dataset, bars = ingest(raw, source)
        return fresh(evaluate(dataset, bars), bars, now)
    except ProviderUnavailable as exc:
        return no_data(symbol, f"Market data is unavailable: {exc}")
    except ValueError as exc:  # includes SymbolNotFound
        return no_data(symbol, f"No usable data: {exc}")


def check(symbols: list[str], fetch: Fetch = http_fetch, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    return {"as_of": now.isoformat(), "symbols": [check_symbol(s, fetch, now) for s in symbols]}
