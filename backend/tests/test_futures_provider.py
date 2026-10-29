"""Offline tests for YahooFuturesDailyProvider. No test touches the network."""
import json
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from app.providers import (ProviderUnavailable, SymbolNotFound, YahooFuturesDailyProvider, YahooFuturesIntradayProvider,
                           import_provider)

NOW = datetime(2026, 10, 30, 12, tzinfo=UTC)  # after the Oct 26-28 sessions have closed


def ny_midnight(day: str) -> int:
    y, m, d = map(int, day.split("-"))
    return int(datetime(y, m, d, tzinfo=ZoneInfo("America/New_York")).timestamp())


def chart(stamps, *, symbol="ZCZ26.CBT", instrument="FUTURE", exchange="CBT", granularity="30m", **overrides):
    n = len(stamps)
    quote = {"open": [100.0] * n, "high": [101.0] * n, "low": [99.0] * n, "close": [100.5] * n, "volume": [1000] * n}
    quote.update(overrides)
    meta = {"symbol": symbol, "instrumentType": instrument, "exchangeName": exchange, "exchangeTimezoneName": "America/New_York",
            "dataGranularity": granularity}
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


# ---- YahooFuturesIntradayProvider ----

def chi(y, mo, d, h, mi=0) -> int:
    return int(datetime(y, mo, d, h, mi, tzinfo=ZoneInfo("America/Chicago")).timestamp())


def iprov(body, now=NOW, **kwargs):
    return YahooFuturesIntradayProvider("ZCZ26", fetch=fetcher(body), now=lambda: now, **kwargs)


def csv_rows(raw: bytes) -> list[str]:
    lines = raw.decode().splitlines()
    assert lines[0] == "timestamp,open,high,low,close,volume"
    return [line.split(",")[0] for line in lines[1:]]


# Trade date Tue 2026-10-27: evening starts Mon 19:00 CDT. NOW (Oct 30 12:00 UTC) is before Oct 30's close.
EVE = [chi(2026, 10, 26, 19), chi(2026, 10, 26, 19, 30)]
DAY = [chi(2026, 10, 27, 8, 30), chi(2026, 10, 27, 9)]


def test_intraday_happy_path_across_trade_date_boundary():
    nxt = [chi(2026, 10, 27, 19), chi(2026, 10, 28, 8, 30)]
    source, raw = iprov(chart(EVE + DAY + nxt)).read()
    assert source.market == "cbot_grains" and source.timeframe_minutes == 30 and source.contract == "ZCZ26"
    assert source.timestamp_convention == "bar_start" and source.timezone == "America/Chicago"
    assert source.source_name == "yahoo_finance_chart_30m_unofficial_60d"
    assert csv_rows(raw) == [
        "2026-10-26T19:00:00-05:00", "2026-10-26T19:30:00-05:00",
        "2026-10-27T08:30:00-05:00", "2026-10-27T09:00:00-05:00",
        "2026-10-27T19:00:00-05:00", "2026-10-28T08:30:00-05:00",
    ]


def test_intraday_url_and_source_for_other_settings():
    urls = []
    p = YahooFuturesIntradayProvider("ZCZ26", minutes=5, period="5d", fetch=fetcher(chart(EVE + DAY, granularity="5m"), urls), now=lambda: NOW)
    source, _ = p.read()
    assert urls == ["https://query1.finance.yahoo.com/v8/finance/chart/ZCZ26.CBT?interval=5m&range=5d&includePrePost=false"]
    assert source.timeframe_minutes == 5 and source.source_name == "yahoo_finance_chart_5m_unofficial_5d"


def test_intraday_null_rows_are_dropped():
    _, raw = iprov(chart(EVE + DAY, close=[100.5, None, 100.5, 100.5])).read()
    assert len(csv_rows(raw)) == 3


def test_intraday_forming_bar_with_odd_timestamp_is_dropped():
    odd = chi(2026, 10, 30, 8, 37)
    _, raw = iprov(chart(EVE + DAY + [odd])).read()
    assert "2026-10-30T08:37:00-05:00" not in csv_rows(raw)
    assert len(csv_rows(raw)) == 4


def test_intraday_open_trade_date_dropped_and_completed_kept():
    stamps = EVE + DAY
    with pytest.raises(ValueError):
        iprov(chart(stamps), now=datetime(2026, 10, 27, 17, tzinfo=UTC)).read()  # 12:00 CT, session open
    _, raw = iprov(chart(stamps), now=datetime(2026, 10, 27, 18, 20, tzinfo=UTC)).read()  # 13:20 CT
    assert len(csv_rows(raw)) == 4
    later = [chi(2026, 10, 27, 19), chi(2026, 10, 28, 8, 30)]
    _, raw = iprov(chart(stamps + later), now=datetime(2026, 10, 27, 18, 30, tzinfo=UTC)).read()
    assert len(csv_rows(raw)) == 4  # Oct 28 is still open


def test_intraday_partial_first_date_dropped_and_kept_with_evening_start():
    nxt = [chi(2026, 10, 27, 19), chi(2026, 10, 28, 8, 30)]
    _, raw = iprov(chart([chi(2026, 10, 26, 23)] + DAY + nxt)).read()
    assert csv_rows(raw) == ["2026-10-27T19:00:00-05:00", "2026-10-28T08:30:00-05:00"]
    # The 19:00 slot is present as a null row: the first date is complete in the response and is kept.
    _, raw = iprov(chart(EVE + DAY + nxt, close=[None, 100.5, 100.5, 100.5, 100.5, 100.5])).read()
    assert csv_rows(raw)[0] == "2026-10-26T19:30:00-05:00" and len(csv_rows(raw)) == 5


def test_intraday_offsets_winter_and_summer():
    winter = [chi(2026, 11, 2, 19), chi(2026, 11, 3, 8, 30)]
    _, raw = iprov(chart(winter), now=datetime(2026, 11, 10, tzinfo=UTC)).read()
    assert csv_rows(raw) == ["2026-11-02T19:00:00-06:00", "2026-11-03T08:30:00-06:00"]
    summer = [chi(2026, 7, 6, 19), chi(2026, 7, 7, 8, 30)]
    _, raw = iprov(chart(summer), now=datetime(2026, 7, 20, tzinfo=UTC)).read()
    assert csv_rows(raw) == ["2026-07-06T19:00:00-05:00", "2026-07-07T08:30:00-05:00"]


@pytest.mark.parametrize("kwargs", [{"instrument": "EQUITY"}, {"exchange": "NYM"}, {"symbol": "ZCH27.CBT"}])
def test_intraday_wrong_metadata_is_unavailable(kwargs):
    with pytest.raises(ProviderUnavailable):
        iprov(chart(EVE + DAY, **kwargs)).read()


def test_intraday_misaligned_arrays_are_unavailable():
    with pytest.raises(ProviderUnavailable):
        iprov(chart(EVE + DAY, volume=[1000])).read()


@pytest.mark.parametrize("kwargs", [{"minutes": 60}, {"minutes": 1}, {"period": "1y"}, {"period": "2d"}])
def test_intraday_invalid_settings_are_rejected(kwargs):
    with pytest.raises(ValueError):
        YahooFuturesIntradayProvider("ZCZ26", fetch=fetcher(b"{}"), now=lambda: NOW, **kwargs)


def test_intraday_invalid_contract_is_rejected():
    with pytest.raises(ValueError):
        YahooFuturesIntradayProvider("ZCA26", fetch=fetcher(b"{}"), now=lambda: NOW)


def test_intraday_unknown_symbol_is_symbol_not_found():
    body = {"chart": {"result": None, "error": {"code": "Not Found", "description": "No data found"}}}
    with pytest.raises(SymbolNotFound):
        iprov(body).read()


def test_intraday_granularity_mismatch_or_missing_rejected():
    for granularity in ("30m", None):
        with pytest.raises(ProviderUnavailable):
            YahooFuturesIntradayProvider("ZCZ26", minutes=5, period="5d",
                                         fetch=fetcher(chart(EVE + DAY, granularity=granularity)),
                                         now=lambda: NOW).read()
