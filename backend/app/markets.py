"""Market specs, grain sessions and trade-date mapping (pure functions).

All CBOT grain specs and the holiday stand-in are UNVERIFIED. Grain sessions
are computed in America/Chicago and returned in UTC. The exchange_calendars
CBOT/XCBT calendar is deliberately NOT used (wrong hours).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Mapping
from zoneinfo import ZoneInfo

SNAPSHOT_PATH = Path(__file__).with_name("markets_registry_snapshot.json")
REGISTRY_ENV = "AG_REGISTRY_PATH"
GRAIN_ROOTS = ("ZC", "ZS", "ZW", "ZM", "ZL", "KE", "ZO", "ZR")

HOLIDAY_STATUS = "unverified"
HOLIDAY_NOTE = (
    "Grain closures use the XNYS regular holiday list as a stand-in; "
    "CME grain holiday schedule not verified."
)
# Dates where the grain day session may close early; flagged, not guessed.
POSSIBLY_INCOMPLETE_DATES = frozenset({date(2026, 11, 27), date(2026, 12, 24)})

_CHI = ZoneInfo("America/Chicago")
_NY = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class MarketSpec:
    market_id: str
    timezone: str
    session_template: str
    price_unit: str
    spec_status: str
    spec_source: str
    retrieved: str
    tick_size: Decimal | None = None  # market-level tick (equity: 0.01)
    tick_sizes: Mapping[str, Decimal] = field(default_factory=dict)  # per root

    def tick_size_for(self, root: str) -> Decimal | None:
        return self.tick_sizes.get(root.upper(), self.tick_size)


def _extract_registry(data: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for inst in data.get("instruments", []):
        sym = inst.get("symbol")
        if sym not in GRAIN_ROOTS:
            continue
        s = inst["specs"]
        out[sym] = {
            "tick_size": str(s["tick_size"]["value"]),
            "price_unit": s["price_unit"]["value"],
            "session_template": s["session_template"]["value"],
        }
    return out


def load_grain_table() -> dict[str, dict]:
    """Return {root: {tick_size(str), price_unit, session_template}}."""
    p = os.environ.get(REGISTRY_ENV)
    if p and Path(p).is_file():
        table = _extract_registry(json.loads(Path(p).read_text(encoding="utf-8")))
        if table:
            return table
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))["instruments"]


def get_market(market_id: str) -> MarketSpec:
    if market_id == "equity_xnys":
        return MarketSpec(
            market_id="equity_xnys", timezone="America/New_York",
            session_template="XNYS 09:30-16:00", price_unit="USD",
            spec_status="verified", spec_source="existing equity behaviour",
            retrieved="2026-10-28", tick_size=Decimal("0.01"),
        )
    if market_id == "cbot_grains":
        table = load_grain_table()
        return MarketSpec(
            market_id="cbot_grains", timezone="America/Chicago",
            session_template="cbot_grains", price_unit="per-root (see tick_sizes)",
            spec_status="unverified", spec_source="Ag registry / vendored snapshot",
            retrieved="2026-10-28",
            tick_sizes={k: Decimal(v["tick_size"]) for k, v in table.items()},
        )
    raise ValueError(f"unknown market: {market_id}")


@lru_cache(maxsize=None)
def _holidays(year: int) -> frozenset[date]:
    import exchange_calendars as xcals

    cal = xcals.get_calendar("XNYS")
    idx = cal.regular_holidays.holidays(start=f"{year}-01-01", end=f"{year}-12-31")
    return frozenset(ts.date() for ts in idx)


def is_holiday(d: date) -> bool:
    return d in _holidays(d.year)


def _is_open_day(d: date) -> bool:
    return d.weekday() < 5 and not is_holiday(d)


def _utc(d: date, t: time, tz: ZoneInfo) -> datetime:
    return datetime.combine(d, t, tzinfo=tz).astimezone(timezone.utc)


def _aware_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        raise ValueError("timestamp must be timezone-aware")
    return ts.astimezone(timezone.utc)


def trade_date_for(ts_utc: datetime, market: MarketSpec) -> date | None:
    """Trade date for a timestamp, or None when the market is closed that day."""
    ts = _aware_utc(ts_utc)
    if market.market_id == "equity_xnys":
        d = ts.astimezone(_NY).date()
        return d if _is_open_day(d) else None
    local = ts.astimezone(_CHI)
    d = local.date() + timedelta(days=1) if local.time() >= time(19, 0) else local.date()
    return d if _is_open_day(d) else None


def session_windows(trade_date: date, market: MarketSpec) -> list[tuple[datetime, datetime]]:
    """UTC (start, end) windows for the trade date; end is exclusive."""
    if not _is_open_day(trade_date):
        return []
    if market.market_id == "equity_xnys":
        return [(_utc(trade_date, time(9, 30), _NY), _utc(trade_date, time(16, 0), _NY))]
    prev = trade_date - timedelta(days=1)  # Monday's evening starts Sunday 19:00
    return [
        (_utc(prev, time(19, 0), _CHI), _utc(trade_date, time(7, 45), _CHI)),
        (_utc(trade_date, time(8, 30), _CHI), _utc(trade_date, time(13, 20), _CHI)),
    ]


def is_session_complete(trade_date: date, as_of_utc: datetime, market: MarketSpec) -> bool:
    wins = session_windows(trade_date, market)
    if not wins:
        return False
    return _aware_utc(as_of_utc) >= wins[-1][1]


def possibly_incomplete(trade_date: date, market: MarketSpec) -> bool:
    """True for known early-close style dates (flagged, not guessed)."""
    if market.market_id != "cbot_grains":
        return False
    # The evening session before a trade date that follows a weekday holiday may not exist.
    prev = trade_date - timedelta(days=1)
    return trade_date in POSSIBLY_INCOMPLETE_DATES or (prev.weekday() < 5 and is_holiday(prev))
