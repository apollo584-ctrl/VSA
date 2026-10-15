"""Providers feed the same validated CSV boundary as uploads; none is a real-time stream."""
import csv
import io
import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

import pandas as pd

from app.data import calendar, ingest, session_window
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
        except (ValueError, KeyError, TypeError) as exc:
            raise ProviderUnavailable("Market data provider returned an unreadable response") from exc
        result = (payload.get("result") or [None])[0]
        if result is None:
            raise SymbolNotFound(f"No market data found for symbol {self.symbol}")
        if not result.get("timestamp"):
            raise ValueError(f"No bars returned for {self.symbol}")
        try:
            quote = result["indicators"]["quote"][0]
            columns = [quote[name] for name in ("open", "high", "low", "close", "volume")]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderUnavailable("Market data provider returned an unreadable response") from exc
        source = self.source()
        step = pd.Timedelta(minutes=self.minutes)
        now = pd.Timestamp(self.now())
        stamps = [pd.Timestamp(t, unit="s", tz="UTC") for t in result["timestamp"]]
        days = [s.tz_convert("America/New_York").strftime("%Y-%m-%d") for s in stamps]
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
