"""CSV boundary: fail closed on malformed, mixed, or ambiguous input."""
import csv
import hashlib
import io
import re
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import exchange_calendars as xcals
import numpy as np
import pandas as pd

from app import bins, grade, markets
from app.models import Bar, Dataset, Parameters, Quality, Source

_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
MAX_ROWS = 50000
MAX_BYTES = 10 * 1024 * 1024


def calendar(start: str, end: str):
    # Pad single-day and holiday-only inputs; the library requires start < end
    # and a schedule with sessions before its session predicates can be queried.
    first = (pd.Timestamp(start) - pd.Timedelta(days=7)).strftime("%Y-%m-%d")
    last = (pd.Timestamp(end) + pd.Timedelta(days=7)).strftime("%Y-%m-%d")
    return xcals.get_calendar("XNYS", start=first, end=last, side="left")


def session_window(cal, session: str, source: Source):
    if not cal.is_session(session):
        raise ValueError(f"{session} is not an XNYS trading session")
    if source.session_mode == "regular":
        return cal.session_open(session), cal.session_close(session)
    # Explicit analysis window, not a claim about every broker/venue's hours.
    day = pd.Timestamp(session, tz="America/New_York")
    return day + pd.Timedelta(hours=4), day + pd.Timedelta(hours=20)


def _grain_open_days(first: date, last: date) -> list[date]:
    days = []
    market = markets.get_market("cbot_grains")
    d = first
    while d <= last:
        if markets.session_windows(d, market):
            days.append(d)
        d += timedelta(days=1)
    return days


def _intraday_quality(bars: list[Bar], source: Source, p: Parameters) -> Quality:
    step = source.timeframe_minutes
    sessions_seen: dict[str, set[int]] = {}
    for b in bars:
        slot = markets.grain_slot(b.timestamp, step)
        sessions_seen.setdefault(b.session, set()).add(slot.session_index)
    expected = [d.isoformat() for d in _grain_open_days(date.fromisoformat(bars[0].session),
                                                        date.fromisoformat(bars[-1].session))]
    absent = [s for s in expected if s not in sessions_seen]
    incomplete = [s for s in sorted(sessions_seen) if sessions_seen[s] != {0, 1}]
    ratios = [max(a.close / b.open, b.open / a.close) for a, b in zip(bars, bars[1:])]
    suspected = any(ratio >= p.split_ratio for ratio in ratios)
    warnings = []
    if absent:
        warnings.append("Missing grain trading days; no bars were filled.")
    if incomplete:
        warnings.append("Some trade dates lack the evening or the day session; no bars were filled.")
    if suspected:
        warnings.append("Large adjacent price discontinuity: possible gap or contract roll. Cross-bar analysis is disabled.")
    if any(b.volume == 0 for b in bars):
        warnings.append("Zero-volume placeholder bars exist; they carry no trading information.")
    warnings.append(grade.YAHOO_LIMITATION)
    warnings.append(grade.SPECS_LIMITATION)
    warnings.append("Grain closures use the XNYS holiday list as a stand-in; CME grain holiday schedule not verified.")
    warnings.append("Quiet periods with no trades are absent bars, not errors")
    return Quality(warnings=warnings, missing_bars=0, absent_sessions=absent,
                   incomplete_sessions=incomplete, split_suspected=suspected)


def _slots_per_day(trade_date: date, step: int) -> int:
    total = 0
    for start, end in markets.session_windows(trade_date, markets.get_market("cbot_grains")):
        total += -(-int((end - start).total_seconds() // 60) // step)
    return total


def _thin_fraction(bars: list[Bar], quality_: Quality, step: int) -> float:
    """Share of expected in-session slots with no bar between the first and last complete trade dates."""
    seen = sorted({b.session for b in bars})
    if not seen:
        return 0.0
    first, last = date.fromisoformat(seen[0]), date.fromisoformat(seen[-1])
    days = {d.isoformat() for d in _grain_open_days(first, last)}
    expected = sum(_slots_per_day(date.fromisoformat(d), step) for d in days)
    have = sum(1 for b in bars if b.session in days)
    return 0.0 if expected <= 0 else max(0, expected - have) / expected


def _futures_quality(bars: list[Bar], source: Source, p: Parameters) -> Quality:
    if source.timeframe_minutes != 1440:
        return _intraday_quality(bars, source, p)
    present = {b.session for b in bars}
    expected = [d.isoformat() for d in _grain_open_days(date.fromisoformat(bars[0].session),
                                                        date.fromisoformat(bars[-1].session))]
    absent = [s for s in expected if s not in present]
    ratios = [max(a.close / b.open, b.open / a.close) for a, b in zip(bars, bars[1:])]
    suspected = any(ratio >= p.split_ratio for ratio in ratios)
    warnings = []
    if absent:
        warnings.append("Missing grain trading days; no bars were filled.")
    if suspected:
        warnings.append("Large adjacent price discontinuity: possible gap or contract roll. Cross-bar analysis is disabled.")
    if any(b.volume == 0 for b in bars):
        warnings.append("Zero-volume placeholder bars exist; they carry no trading information.")
    warnings.append(grade.YAHOO_LIMITATION)
    warnings.append(grade.SPECS_LIMITATION)
    warnings.append("Grain closures use the XNYS holiday list as a stand-in; CME grain holiday schedule not verified.")
    return Quality(warnings=warnings, missing_bars=len(absent), absent_sessions=absent,
                   incomplete_sessions=[], split_suspected=suspected)


INTRADAY_VOLUME_LIMITATION = ("Intraday volume is partial (about 90% of the daily total) and intraday "
                              "closes are last trades, not settlements")


def _ingest_grain_intraday(raw: bytes, rows: list[dict], source: Source) -> tuple[Dataset, list[Bar]]:
    step = source.timeframe_minutes
    if step not in markets.GRAIN_STEP_MINUTES:
        raise ValueError("Intraday grain data must use 5, 15 or 30 minute bars")
    if source.timestamp_convention != "bar_start":
        raise ValueError("Intraday grain data must use bar_start timestamps")
    if not source.contract:
        raise ValueError("Grain data requires a contract")
    expiry = markets.contract_last_trade_date(source.contract)
    market = markets.get_market("cbot_grains")
    chicago = ZoneInfo("America/Chicago")
    stamps = []
    awareness = set()
    for index, row in enumerate(rows):
        label = f"Row {index + 2}"
        try:
            stamp = pd.Timestamp(row["timestamp"].strip())
            if pd.isna(stamp):
                raise ValueError("missing")
            awareness.add(stamp.tzinfo is not None)
            if stamp.tzinfo is None:
                stamp = stamp.tz_localize(chicago, ambiguous="raise", nonexistent="raise")
            if stamp.nanosecond:
                raise ValueError("sub-microsecond precision")
            stamps.append(stamp.tz_convert("UTC"))
        except Exception as exc:
            raise ValueError(f"{label}: invalid, ambiguous, or nonexistent timestamp") from exc
    if len(awareness) != 1:
        raise ValueError("Do not mix naive and offset-aware timestamp conventions")
    if any(b <= a for a, b in zip(stamps, stamps[1:])):
        raise ValueError("Timestamps must be strictly increasing; duplicates are rejected")
    names = ["open", "high", "low", "close", "volume"]
    bars: list[Bar] = []
    for index, (row, stamp) in enumerate(zip(rows, stamps)):
        label = f"Row {index + 2}"
        start = stamp.to_pydatetime()
        try:
            slot = markets.grain_slot(start, step)
        except ValueError as exc:
            raise ValueError(f"{label}: {exc}") from exc
        if slot.trade_date > expiry:
            raise ValueError(f"{label}: bar after contract expiry (possible contract roll)")
        try:
            values = [float(row[name]) for name in names]
        except ValueError as exc:
            raise ValueError(f"{label}: OHLCV must be numeric") from exc
        o, h, low, c, v = values
        if not np.isfinite(values).all() or min(o, h, low, c) <= 0 or v < 0:
            raise ValueError(f"{label}: finite positive OHLC and nonnegative volume required")
        if max(o, h, low, c) > 1e9 or v > 1e15:
            raise ValueError(f"{label}: numerical safety bounds are OHLC <= 1e9 and volume <= 1e15")
        if low > min(o, c) or h < max(o, c) or low > h:
            raise ValueError(f"{label}: inconsistent OHLC")
        bars.append(Bar(timestamp=start, available_at=start + timedelta(minutes=step),
                        session=slot.trade_date.isoformat(), open=o, high=h, low=low, close=c, volume=v))
    if (bars[-1].timestamp - bars[0].timestamp).days > 366 * 5:
        raise ValueError("A dataset may span at most five years")
    root = markets.contract_parts(source.contract)[0]
    tick = market.tick_size_for(root)
    placeholders = sum(1 for b in bars if b.volume == 0 and b.open == b.high == b.low == b.close)
    moving_zero = sum(1 for b in bars if b.volume == 0 and not (b.open == b.high == b.low == b.close))
    off_grid = 0
    if tick is not None:
        off_grid = bins.off_grid_count([x for b in bars for x in (b.open, b.high, b.low, b.close)], tick)
    qual = quality(bars, source)
    extra = [INTRADAY_VOLUME_LIMITATION]
    if moving_zero:
        extra.append(f"{moving_zero} zero-volume bar(s) where the price moved")
    thin = _thin_fraction(bars, qual, step)
    if thin > 0.30:
        extra.append(f"Thin trading: {thin:.0%} of expected in-session bars are absent")
    result = grade.grade_futures(step, True, len(bars), placeholders, off_grid, market.spec_status, extra)
    dataset = Dataset(id=str(uuid4()), content_sha256=hashlib.sha256(raw).hexdigest(), source=source,
                      created_at=datetime.now(UTC), row_count=len(bars), first_timestamp=bars[0].timestamp,
                      last_available_at=bars[-1].available_at, quality=qual,
                      data_grade=result.grade, grade_basis=result.basis, limitations=list(result.limitations))
    return dataset, bars


def _ingest_futures(raw: bytes, rows: list[dict], source: Source) -> tuple[Dataset, list[Bar]]:
    if source.timeframe_minutes != 1440:
        return _ingest_grain_intraday(raw, rows, source)
    expiry = markets.contract_last_trade_date(source.contract)
    market = markets.get_market("cbot_grains")
    names = ["open", "high", "low", "close", "volume"]
    bars: list[Bar] = []
    previous: date | None = None
    for index, row in enumerate(rows):
        label = f"Row {index + 2}"
        cell = row["timestamp"].strip()
        if not _ISO_DATE.fullmatch(cell):
            raise ValueError(f"{label}: daily timestamp must be an ISO date YYYY-MM-DD")
        try:
            day = date.fromisoformat(cell)
        except ValueError as exc:
            raise ValueError(f"{label}: daily timestamp must be an ISO date YYYY-MM-DD") from exc
        if previous is not None and day <= previous:
            raise ValueError("Timestamps must be strictly increasing; duplicates are rejected")
        previous = day
        windows = markets.session_windows(day, market)
        if not windows:
            raise ValueError(f"{label}: {cell} is not a grain trading day")
        if day > expiry:
            raise ValueError(f"{label}: bar after contract expiry (possible contract roll)")
        try:
            values = [float(row[name]) for name in names]
        except ValueError as exc:
            raise ValueError(f"{label}: OHLCV must be numeric") from exc
        o, h, low, c, v = values
        if not np.isfinite(values).all() or min(o, h, low, c) <= 0 or v < 0:
            raise ValueError(f"{label}: finite positive OHLC and nonnegative volume required")
        if max(o, h, low, c) > 1e9 or v > 1e15:
            raise ValueError(f"{label}: numerical safety bounds are OHLC <= 1e9 and volume <= 1e15")
        if low > min(o, c) or h < max(o, c) or low > h:
            raise ValueError(f"{label}: inconsistent OHLC")
        bars.append(Bar(timestamp=windows[0][0], available_at=windows[-1][1], session=cell,
                        open=o, high=h, low=low, close=c, volume=v))
    if (date.fromisoformat(bars[-1].session) - date.fromisoformat(bars[0].session)).days > 366 * 5:
        raise ValueError("A dataset may span at most five years")
    root = markets.contract_parts(source.contract)[0]
    tick = market.tick_size_for(root)
    placeholders = sum(1 for b in bars if b.volume == 0 and b.open == b.high == b.low == b.close)
    off_grid = 0
    if tick is not None:
        off_grid = bins.off_grid_count([x for b in bars for x in (b.open, b.high, b.low, b.close)], tick)
    result = grade.grade_futures(1440, True, len(bars), placeholders, off_grid, market.spec_status)
    limitations = list(result.limitations)
    if placeholders:
        limitations.append(f"{placeholders} placeholder bar(s) with no trading")
    if off_grid:
        limitations.append(f"{off_grid} price(s) off the contract tick grid")
    dataset = Dataset(id=str(uuid4()), content_sha256=hashlib.sha256(raw).hexdigest(), source=source,
                      created_at=datetime.now(UTC), row_count=len(bars), first_timestamp=bars[0].timestamp,
                      last_available_at=bars[-1].available_at, quality=quality(bars, source),
                      data_grade=result.grade, grade_basis=result.basis, limitations=limitations)
    return dataset, bars


def quality(bars: list[Bar], source: Source, parameters: Parameters | None = None) -> Quality:
    p = parameters or Parameters()
    if source.market == "cbot_grains":
        return _futures_quality(bars, source, p)
    first, last = bars[0].session, bars[-1].session
    cal = calendar(first, last)
    grouped: dict[str, list[Bar]] = {}
    for bar in bars:
        grouped.setdefault(bar.session, []).append(bar)
    missing = 0
    incomplete = []
    absent = []
    interval = pd.Timedelta(minutes=source.timeframe_minutes)
    for day in cal.sessions_in_range(first, last):
        session = day.strftime("%Y-%m-%d")
        start, end = session_window(cal, session, source)
        expected = pd.date_range(start, end, freq=interval, inclusive="left")
        present = {pd.Timestamp(b.timestamp) for b in grouped.get(session, [])}
        missing += len(set(expected) - present)
        if len(present) != len(expected):
            incomplete.append(session)
        if not present:
            absent.append(session)
    ratios = [max(a.close / b.open, b.open / a.close) for a, b in zip(bars, bars[1:])]
    suspected = any(ratio >= p.split_ratio for ratio in ratios)
    warnings = []
    if missing:
        warnings.append("Missing scheduled bars; leading/trailing gaps include incomplete sessions. No bars were filled.")
    if suspected:
        warnings.append("Large adjacent price discontinuity: possible split or gap. Cross-bar analysis is disabled; upload a consistent series.")
    if any(b.volume == 0 for b in bars):
        warnings.append("Zero-volume bars exist; relative-volume baselines can be unavailable.")
    if source.session_mode == "extended":
        warnings.append("Extended window is 04:00–20:00 New York on XNYS session dates, including early-close dates; venue availability is not verified.")
    warnings.append("Adjustment metadata is uploader-declared; corporate actions are not independently verified.")
    return Quality(warnings=warnings, missing_bars=missing, absent_sessions=absent,
                   incomplete_sessions=incomplete, split_suspected=suspected)


def ingest(raw: bytes, source: Source) -> tuple[Dataset, list[Bar]]:
    if len(raw) > MAX_BYTES:
        raise ValueError("CSV exceeds 10 MiB")
    try:
        ZoneInfo(source.timezone)
        content = raw.decode("utf-8-sig")
    except (UnicodeDecodeError, ZoneInfoNotFoundError) as exc:
        raise ValueError("CSV must be UTF-8; timezone must be an IANA name") from exc
    try:
        reader = csv.DictReader(io.StringIO(content), strict=True)
        expected = ["timestamp", "open", "high", "low", "close", "volume"]
        if reader.fieldnames != expected:
            raise ValueError("CSV header must be timestamp,open,high,low,close,volume in that order")
        rows = []
        for row in reader:
            if len(rows) >= MAX_ROWS:
                raise ValueError("CSV exceeds 50000 bars")
            if None in row or any(value is None or not value.strip() for value in row.values()):
                raise ValueError(f"Malformed or missing cells at row {len(rows) + 2}")
            rows.append(row)
    except csv.Error as exc:
        raise ValueError("Malformed CSV: invalid quoting or oversized field") from exc
    if not rows:
        raise ValueError("CSV must contain bars")
    if source.market == "cbot_grains":
        return _ingest_futures(raw, rows, source)
    stamps = []
    awareness = set()
    try:
        for row in rows:
            stamp = pd.Timestamp(row["timestamp"])
            if pd.isna(stamp):
                raise ValueError("Missing timestamp")
            awareness.add(stamp.tzinfo is not None)
            if stamp.tzinfo is None:
                stamp = stamp.tz_localize(source.timezone, ambiguous="raise", nonexistent="raise")
            stamps.append(stamp.tz_convert("UTC"))
    except Exception as exc:
        raise ValueError("Invalid, ambiguous, or nonexistent timestamp") from exc
    if len(awareness) != 1:
        raise ValueError("Do not mix naive and offset-aware timestamp conventions")
    if any(b <= a for a, b in zip(stamps, stamps[1:])):
        raise ValueError("Timestamps must be strictly increasing; duplicates are rejected")
    step = pd.Timedelta(minutes=source.timeframe_minutes)
    if source.timestamp_convention == "bar_end":
        stamps = [stamp - step for stamp in stamps]
    dates = [stamp.tz_convert("America/New_York").strftime("%Y-%m-%d") for stamp in stamps]
    if (stamps[-1] - stamps[0]).days > 366 * 5:
        raise ValueError("A dataset may span at most five years")
    cal = calendar(dates[0], dates[-1])
    bars = []
    for index, (row, stamp, day) in enumerate(zip(rows, stamps, dates)):
        start, end = session_window(cal, day, source)
        if stamp < start or stamp + step > end or (stamp - start) % step != pd.Timedelta(0):
            raise ValueError(f"Row {index + 2}: bar must fit session window and align to its open; partial bars are unsupported")
        try:
            values = [float(row[name]) for name in expected[1:]]
        except ValueError as exc:
            raise ValueError(f"Row {index + 2}: OHLCV must be numeric") from exc
        o, h, low, c, v = values
        if not np.isfinite(values).all() or min(o, h, low, c) <= 0 or v < 0:
            raise ValueError(f"Row {index + 2}: finite positive OHLC and nonnegative volume required")
        if max(o, h, low, c) > 1e9 or v > 1e15:
            raise ValueError(f"Row {index + 2}: numerical safety bounds are OHLC <= 1e9 and volume <= 1e15")
        if low > min(o, c) or h < max(o, c) or low > h:
            raise ValueError(f"Row {index + 2}: inconsistent OHLC")
        bars.append(Bar(timestamp=stamp.to_pydatetime(), available_at=(stamp + step).to_pydatetime(),
                        session=day, open=o, high=h, low=low, close=c, volume=v))
    dataset = Dataset(id=str(uuid4()), content_sha256=hashlib.sha256(raw).hexdigest(), source=source,
                      created_at=datetime.now(UTC), row_count=len(bars), first_timestamp=bars[0].timestamp,
                      last_available_at=bars[-1].available_at, quality=quality(bars, source))
    return dataset, bars
