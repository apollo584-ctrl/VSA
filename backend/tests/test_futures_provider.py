"""Offline tests for YahooFuturesDailyProvider. No test touches the network."""
import json
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from app.providers import ProviderUnavailable, SymbolNotFound, YahooFuturesDailyProvider, import_provider

NOW = datetime(2026, 10, 30, 12, tzinfo=UTC)  # after the Oct 26-28 sessions have closed


def ny_midnight(day: str) -> int:
    y, m, d = map(int, day.split("-"))
    return int(datetime(y, m, d, tzinfo=ZoneInfo("America/New_York")).timestamp())


def chart(stamps, *, symbol="ZCZ26.CBT", instrument="FUTURE", exchange="CBT", **overrides):
    n = len(stamps)
    quote = {"open": [100.0] * n, "high": [101.0] * n, "low": [99.0] * n, "close": [100.5] * n, "volume": [1000] * n}
    quote.update(overrides)
    meta = {"symbol": symbol, "instrumentType": instrument, "exchangeName": exchange, "exchangeTimezoneName": "America/New_York"}
    return {"chart": {"result": [{"meta": meta, "timestamp": stamps, "indicators": {"quote": [quote]}}], "error": None}}


def fetcher(body, urls=None):
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()

    def fetch(url):
        if urls is not None:
            urls.append(url)
        return raw

    return fetch


def provider(body, now=NOW, **kwargs):
    return YahooFuturesDailyProvider("ZCZ26", fetch=fetcher(body), now=lambda: now, **kwargs)


def csv_dates(raw: bytes) -> list[str]:
    lines = raw.decode().splitlines()
    assert lines[0] == "timestamp,open,high,low,close,volume"
    return [line.split(",")[0] for line in lines[1:]]


def test_happy_path_imports_as_cbot_grain_dataset():
    stamps = [ny_midnight(d) for d in ("2026-10-26", "2026-10-27", "2026-10-28")]
    dataset, bars = import_provider(provider(chart(stamps)))
    assert dataset.data_grade == "C"
    assert dataset.source.market == "cbot_grains"
    assert dataset.source.contract == "ZCZ26"
    assert dataset.row_count == 3
    assert len(bars) == 3


def test_source_and_url_are_declared_correctly():
    urls = []
    p = YahooFuturesDailyProvider("ZCZ26", period="6mo", fetch=fetcher(chart([ny_midnight("2026-10-26")]), urls), now=lambda: NOW)
    source, _ = p.read()
    assert source.timeframe_minutes == 1440
    assert source.timezone == "America/Chicago"
    assert source.exchange == "CBOT"
    assert source.price_adjustment == "unadjusted"
    assert source.volume_adjustment == "raw"
    assert source.source_name == "yahoo_finance_chart_1d_unofficial_6mo"
    assert len(urls) == 1
    assert "ZCZ26.CBT" in urls[0]
    assert "interval=1d" in urls[0]
    assert "range=6mo" in urls[0]


def test_forming_day_is_dropped_before_close_and_kept_after_close():
    stamps = [ny_midnight("2026-10-27"), ny_midnight("2026-10-28")]
    _, raw_before = provider(chart(stamps), now=datetime(2026, 10, 28, 15, tzinfo=UTC)).read()
    assert csv_dates(raw_before) == ["2026-10-27"]
    _, raw_after = provider(chart(stamps), now=datetime(2026, 10, 28, 19, tzinfo=UTC)).read()
    assert csv_dates(raw_after) == ["2026-10-27", "2026-10-28"]


def test_winter_midnight_stamp_gives_correct_date():
    stamp = int(datetime(2026, 11, 2, 5, tzinfo=UTC).timestamp())  # New York midnight in standard time
    _, raw = provider(chart([stamp]), now=datetime(2026, 11, 5, tzinfo=UTC)).read()
    assert csv_dates(raw) == ["2026-11-02"]


def test_wrong_instrument_type_is_unavailable():
    with pytest.raises(ProviderUnavailable):
        provider(chart([ny_midnight("2026-10-26")], instrument="EQUITY")).read()


def test_wrong_exchange_is_unavailable():
    with pytest.raises(ProviderUnavailable):
        provider(chart([ny_midnight("2026-10-26")], exchange="CME")).read()


def test_symbol_mismatch_is_unavailable():
    with pytest.raises(ProviderUnavailable):
        provider(chart([ny_midnight("2026-10-26")], symbol="ZCH27.CBT")).read()


def test_non_midnight_stamp_is_unavailable():
    with pytest.raises(ProviderUnavailable):
        provider(chart([ny_midnight("2026-10-26") + 3600])).read()


def test_misaligned_arrays_are_unavailable():
    with pytest.raises(ProviderUnavailable):
        provider(chart([ny_midnight("2026-10-26"), ny_midnight("2026-10-27")], close=[100.5])).read()


def test_null_rows_are_dropped():
    stamps = [ny_midnight(d) for d in ("2026-10-26", "2026-10-27", "2026-10-28")]
    _, raw = provider(chart(stamps, close=[100.5, None, 100.7])).read()
    assert csv_dates(raw) == ["2026-10-26", "2026-10-28"]


def test_all_null_rows_raise_value_error():
    with pytest.raises(ValueError):
        provider(chart([ny_midnight("2026-10-26")], close=[None])).read()


def test_invalid_period_is_rejected():
    with pytest.raises(ValueError):
        YahooFuturesDailyProvider("ZCZ26", period="5d", fetch=fetcher(b"{}"), now=lambda: NOW)


def test_unknown_symbol_is_symbol_not_found():
    body = {"chart": {"result": None, "error": {"code": "Not Found", "description": "No data found, symbol may be delisted"}}}
    with pytest.raises(SymbolNotFound):
        provider(body).read()
