"""CSV boundary: fail closed on malformed, mixed, or ambiguous input."""
import csv
import hashlib
import io
from datetime import UTC, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import exchange_calendars as xcals
import numpy as np
import pandas as pd

from app.models import Bar, Dataset, Parameters, Quality, Source

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


def quality(bars: list[Bar], source: Source, parameters: Parameters | None = None) -> Quality:
    p = parameters or Parameters()
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
