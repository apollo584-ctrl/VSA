"""Providers feed the same validated CSV boundary as uploads; none is a real-time stream."""
import csv
import io
import json
import math
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

import pandas as pd

from app.data import calendar, ingest, session_window
from app.markets import contract_parts, get_market, is_session_complete, session_windows, trade_date_for
from app.models import Bar, Dataset, Source


class HistoricalDataProvider(Protocol):
    def read(self) -> tuple[Source, bytes]:
        """Return declared provenance and canonical UTF-8 OHLCV CSV bytes."""
        ...


def import_provider(provider: HistoricalDataProvider) -> tuple[Dataset, list[Bar]]:
    """Never bypass CSV/session validation when adding a future adapter."""
    source, raw = provider.read()
    return ingest(raw, source)


class SymbolNotFound(ValueError):
    """The provider has no data for the requested symbol."""


class ProviderUnavailable(RuntimeError):
    """The provider could not be reached or answered unusably."""


YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}m&range={period}&includePrePost=false"
Fetch = Callable[[str], bytes]


def http_fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (market-structure-intelligence)", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.read(20 * 1024 * 1024)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:  # Yahoo answers unknown symbols with a JSON error body
            return exc.read(1024 * 1024)
        raise ProviderUnavailable(f"Market data provider answered HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderUnavailable("Market data provider could not be reached") from exc


class YahooChartProvider:
    """Recent completed regular-session bars from Yahoo Finance's unofficial chart endpoint.

    Intended for testing and personal analysis, not redistribution: the endpoint is undocumented, delayed and may change
    or be rate-limited. Bars still forming or outside the exchange's regular session window are dropped, never repaired.
    """

    def __init__(self, symbol: str, timeframe_minutes: int = 30, period: str = "1mo",
                 fetch: Fetch = http_fetch, now: Callable[[], datetime] = lambda: datetime.now(UTC)):
        self.symbol, self.minutes, self.period, self.fetch, self.now = symbol, timeframe_minutes, period, fetch, now

    def source(self) -> Source:
        return Source(instrument=self.symbol, timeframe_minutes=self.minutes, source_name=f"yahoo_finance_chart_{self.period}",
                      price_adjustment="split_adjusted", volume_adjustment="split_adjusted")

    def read(self) -> tuple[Source, bytes]:
        url = YAHOO_CHART_URL.format(symbol=urllib.parse.quote(self.symbol, safe=""), interval=self.minutes, period=self.period)
        try:
            payload = json.loads(self.fetch(url))["chart"]
            if not isinstance(payload, dict):
                raise ValueError("chart must be an object")
            results = payload["result"]
            if results is None or results == []:
                error = payload.get("error")
                if isinstance(error, dict) and error.get("code") == "Not Found":
                    raise SymbolNotFound(f"No market data found for symbol {self.symbol}")
                raise ValueError("missing chart result")
            if not isinstance(results, list) or len(results) != 1 or payload.get("error") is not None:
                raise ValueError("expected one successful chart result")
            result = results[0]
            returned_symbol = result["meta"]["symbol"]
            # No undocumented aliases: an upstream identity mismatch must never relabel bars.
            if not isinstance(returned_symbol, str) or returned_symbol.strip().upper() != self.symbol.strip().upper():
                raise ValueError("returned symbol does not match requested symbol")
            meta = result["meta"]
            # These US equity venues share the supported XNYS regular-session calendar.
            if (meta.get("exchangeName") not in ("NYQ", "NMS", "NGM", "NCM", "ASE", "PCX", "BTS")
                    or meta.get("exchangeTimezoneName") != "America/New_York"
                    or meta.get("instrumentType") not in ("EQUITY", "ETF")):
                raise ValueError("unsupported market metadata; US equities and ETFs required")
            timestamps = result["timestamp"]
            if not isinstance(timestamps, list) or any(
                type(t) not in (int, float) or not math.isfinite(t) for t in timestamps
            ):
                raise ValueError("timestamps must be finite numeric epoch seconds")
            quote = result["indicators"]["quote"][0]
            columns = [quote[name] for name in ("open", "high", "low", "close", "volume")]
            if any(not isinstance(column, list) or len(column) != len(timestamps) for column in columns):
                raise ValueError("OHLCV arrays must align with timestamps")
            if any(value is not None and type(value) not in (int, float) for column in columns for value in column):
                raise ValueError("OHLCV values must be numeric or null")
            stamps = [pd.Timestamp(t, unit="s", tz="UTC") for t in timestamps]
            days = [s.tz_convert("America/New_York").strftime("%Y-%m-%d") for s in stamps]
        except SymbolNotFound:
            raise
        except (ValueError, KeyError, IndexError, TypeError, OverflowError) as exc:
            raise ProviderUnavailable("Market data provider returned an unreadable response") from exc
        if not timestamps:
            raise ValueError(f"No bars returned for {self.symbol}")
        source = self.source()
        step = pd.Timedelta(minutes=self.minutes)
        now = pd.Timestamp(self.now())
        cal = calendar(min(days), max(days))
        windows: dict[str, tuple] = {}
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        rows = 0
        for stamp, day, *values in zip(stamps, days, *columns):
            if any(v is None for v in values) or stamp + step > now or not cal.is_session(day):
                continue
            start, end = windows.setdefault(day, session_window(cal, day, source))
            if stamp < start or stamp + step > end or (stamp - start) % step != pd.Timedelta(0):
                continue
            writer.writerow([stamp.tz_convert("America/New_York").isoformat(), *values])
            rows += 1
        if not rows:
            raise ValueError(f"No completed regular-session bars are available for {self.symbol}")
        return source, output.getvalue().encode()


YAHOO_FUTURES_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range={period}&includePrePost=false"
YAHOO_FUTURES_PERIODS = ("1mo", "6mo", "1y", "2y")


class YahooFuturesDailyProvider:
    """Completed daily bars for one CBOT grain contract (e.g. ZCZ26 -> ZCZ26.CBT) from Yahoo Finance's unofficial chart endpoint.

    Same caveats as YahooChartProvider. Rows with any null value or a trade date that is still forming are dropped, never
    repaired. Closed-day and post-expiry dates are passed through unchanged; ingest rejects them (fail closed).
    """

    def __init__(self, contract: str, period: str = "1y", fetch: Fetch = http_fetch,
                 now: Callable[[], datetime] = lambda: datetime.now(UTC)):
        if period not in YAHOO_FUTURES_PERIODS:
            raise ValueError(f"unsupported period: {period!r}")
        contract_parts(contract)  # raises ValueError for malformed contract codes
        self.contract, self.period, self.fetch, self.now = contract, period, fetch, now
        self.symbol = f"{contract}.CBT"

    def source(self) -> Source:
        return Source(instrument=self.contract, timeframe_minutes=1440, market="cbot_grains", exchange="CBOT",
                      timezone="America/Chicago", contract=self.contract, price_adjustment="unadjusted",
                      volume_adjustment="raw", source_name=f"yahoo_finance_chart_1d_unofficial_{self.period}")

    def read(self) -> tuple[Source, bytes]:
        url = YAHOO_FUTURES_CHART_URL.format(symbol=urllib.parse.quote(self.symbol, safe=""), period=self.period)
        try:
            payload = json.loads(self.fetch(url))["chart"]
            if not isinstance(payload, dict):
                raise ValueError("chart must be an object")
            results = payload["result"]
            if results is None or results == []:
                error = payload.get("error")
                if isinstance(error, dict) and error.get("code") == "Not Found":
                    raise SymbolNotFound(f"No market data found for symbol {self.symbol}")
                raise ValueError("missing chart result")
            if not isinstance(results, list) or len(results) != 1 or payload.get("error") is not None:
                raise ValueError("expected one successful chart result")
            result = results[0]
            meta = result["meta"]
            returned_symbol = meta["symbol"]
            # No undocumented aliases: an upstream identity mismatch must never relabel bars.
            if not isinstance(returned_symbol, str) or returned_symbol.strip().upper() != self.symbol.strip().upper():
                raise ValueError("returned symbol does not match requested symbol")
            if meta.get("instrumentType") != "FUTURE" or meta.get("exchangeName") != "CBT":
                raise ValueError("unsupported market metadata; CBOT futures required")
            timestamps = result["timestamp"]
            if not isinstance(timestamps, list) or any(
                type(t) not in (int, float) or not math.isfinite(t) for t in timestamps
            ):
                raise ValueError("timestamps must be finite numeric epoch seconds")
            quote = result["indicators"]["quote"][0]
            columns = [quote[name] for name in ("open", "high", "low", "close", "volume")]
            if any(not isinstance(column, list) or len(column) != len(timestamps) for column in columns):
                raise ValueError("OHLCV arrays must align with timestamps")
            if any(value is not None and type(value) not in (int, float) for column in columns for value in column):
                raise ValueError("OHLCV values must be numeric or null")
            # Yahoo stamps daily bars at New York midnight; that New York date is the bar's date label.
            stamps = [pd.Timestamp(t, unit="s", tz="UTC").tz_convert("America/New_York") for t in timestamps]
            for s in stamps:
                if (s.hour, s.minute, s.second, s.microsecond, s.nanosecond) != (0, 0, 0, 0, 0):
                    raise ValueError("daily bar timestamps must be New York midnight")
            dates = [s.date() for s in stamps]
        except SymbolNotFound:
            raise
        except (ValueError, KeyError, IndexError, TypeError, OverflowError) as exc:
            raise ProviderUnavailable("Market data provider returned an unreadable response") from exc
        if not timestamps:
            raise ValueError(f"No bars returned for {self.symbol}")
        source = self.source()
        market = get_market("cbot_grains")
        now_utc = self.now()
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        rows = 0
        for day, *values in zip(dates, *columns):
            if any(v is None for v in values):
                continue
            # Closed days (no session windows) are passed through; only a session still forming is dropped.
            if session_windows(day, market) and not is_session_complete(day, now_utc, market):
                continue
            writer.writerow([day.isoformat(), *values])
            rows += 1
        if not rows:
            raise ValueError(f"No completed daily bars are available for {self.symbol}")
        return source, output.getvalue().encode()


YAHOO_FUTURES_INTRADAY_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={minutes}m&range={period}&includePrePost=false"
YAHOO_FUTURES_INTRADAY_MINUTES = (5, 15, 30)
YAHOO_FUTURES_INTRADAY_PERIODS = ("5d", "1mo", "60d")


class YahooFuturesIntradayProvider:
    """Completed 5/15/30 minute bars for one CBOT grain contract (e.g. ZCZ26 -> ZCZ26.CBT) from the unofficial Yahoo chart endpoint.

    Same caveats as YahooChartProvider. Timestamps are bar-start. Dropped, never repaired: rows with any null value, bars of
    trade dates whose session is not complete yet, and a partial first trade date (response lacks its 19:00 CT evening slot).
    Everything else (including invalid positions) passes through; ingest rejects it (fail closed).
    """

    def __init__(self, contract: str, minutes: int = 30, period: str = "60d", fetch: Fetch = http_fetch,
                 now: Callable[[], datetime] = lambda: datetime.now(UTC)):
        if minutes not in YAHOO_FUTURES_INTRADAY_MINUTES:
            raise ValueError(f"unsupported minutes: {minutes!r}")
        if period not in YAHOO_FUTURES_INTRADAY_PERIODS:
            raise ValueError(f"unsupported period: {period!r}")
        contract_parts(contract)  # raises ValueError for malformed contract codes
        self.contract, self.minutes, self.period, self.fetch, self.now = contract, minutes, period, fetch, now
        self.symbol = f"{contract}.CBT"

    def source(self) -> Source:
        return Source(instrument=self.contract, timeframe_minutes=self.minutes, market="cbot_grains", exchange="CBOT",
                      timezone="America/Chicago", contract=self.contract, timestamp_convention="bar_start",
                      price_adjustment="unadjusted", volume_adjustment="raw",
                      source_name=f"yahoo_finance_chart_{self.minutes}m_unofficial_{self.period}")

    def read(self) -> tuple[Source, bytes]:
        url = YAHOO_FUTURES_INTRADAY_URL.format(symbol=urllib.parse.quote(self.symbol, safe=""),
                                                minutes=self.minutes, period=self.period)
        try:
            payload = json.loads(self.fetch(url))["chart"]
            if not isinstance(payload, dict):
                raise ValueError("chart must be an object")
            results = payload["result"]
            if results is None or results == []:
                error = payload.get("error")
                if isinstance(error, dict) and error.get("code") == "Not Found":
                    raise SymbolNotFound(f"No market data found for symbol {self.symbol}")
                raise ValueError("missing chart result")
            if not isinstance(results, list) or len(results) != 1 or payload.get("error") is not None:
                raise ValueError("expected one successful chart result")
            result = results[0]
            meta = result["meta"]
            returned_symbol = meta["symbol"]
            if not isinstance(returned_symbol, str) or returned_symbol.strip().upper() != self.symbol.strip().upper():
                raise ValueError("returned symbol does not match requested symbol")
            if meta.get("instrumentType") != "FUTURE" or meta.get("exchangeName") != "CBT":
                raise ValueError("unsupported market metadata; CBOT futures required")
            if meta.get("dataGranularity") != f"{self.minutes}m":
                raise ValueError("returned bar granularity does not match the requested interval")
            timestamps = result["timestamp"]
            if not isinstance(timestamps, list) or any(
                type(t) not in (int, float) or not math.isfinite(t) for t in timestamps
            ):
                raise ValueError("timestamps must be finite numeric epoch seconds")
            quote = result["indicators"]["quote"][0]
            columns = [quote[name] for name in ("open", "high", "low", "close", "volume")]
            if any(not isinstance(column, list) or len(column) != len(timestamps) for column in columns):
                raise ValueError("OHLCV arrays must align with timestamps")
            if any(value is not None and type(value) not in (int, float) for column in columns for value in column):
                raise ValueError("OHLCV values must be numeric or null")
            stamps = [pd.Timestamp(t, unit="s", tz="UTC") for t in timestamps]
        except SymbolNotFound:
            raise
        except (ValueError, KeyError, IndexError, TypeError, OverflowError) as exc:
            raise ProviderUnavailable("Market data provider returned an unreadable response") from exc
        if not timestamps:
            raise ValueError(f"No bars returned for {self.symbol}")
        source = self.source()
        market = get_market("cbot_grains")
        now_utc = self.now()
        dates = [trade_date_for(s.to_pydatetime(), market) for s in stamps]
        # Partial first trade date: no response timestamp (null rows included) is that date's 19:00 CT evening start.
        partial_first = None
        known = [d for d in dates if d is not None]
        if known:
            first = min(known)
            windows = session_windows(first, market)
            if windows and windows[0][0] not in {s.to_pydatetime() for s in stamps}:
                partial_first = first
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        rows = 0
        for stamp, day, *values in zip(stamps, dates, *columns):
            if any(v is None for v in values):
                continue
            if day is not None and (not is_session_complete(day, now_utc, market) or day == partial_first):
                continue
            writer.writerow([stamp.tz_convert("America/Chicago").isoformat(), *values])
            rows += 1
        if not rows:
            raise ValueError(f"No completed intraday bars are available for {self.symbol}")
        return source, output.getvalue().encode()
