import json

import pandas as pd
import pytest
from pydantic import ValidationError

from app.data import ingest
from app.models import Source
from tests.conftest import csv_bytes, make_bar


@pytest.mark.parametrize("row", [
    "2025-03-10T09:30:00-04:00,100,99,98,100,1000",  # invalid high
    "2025-03-10T09:30:00-04:00,100,101,99,100,-1",
    "2025-03-10T09:30:00-04:00,100,NaN,99,100,1",
    "2025-03-10T09:30:00-04:00,100,101,99,100,inf",
    "2025-03-10T09:30:00-04:00,0,101,0,100,1",
    "2025-03-10T09:30:00-04:00,100,101,99,100,",
    "2025-03-10T09:30:00-04:00,100,101,99,100,1,extra",
    "2025-03-10T09:31:00-04:00,100,101,99,100,1",
    "2025-03-10T16:00:00-04:00,100,101,99,100,1",
    "2025-12-25T09:30:00-05:00,100,101,99,100,1",
])
def test_rejects_invalid_input(source, row):
    with pytest.raises(ValueError):
        ingest(("timestamp,open,high,low,close,volume\n" + row + "\n").encode(), source)


def test_duplicates_order_and_empty(source):
    for bars in [[make_bar(0), make_bar(0)], [make_bar(1), make_bar(0)]]:
        with pytest.raises(ValueError, match="strictly increasing"):
            ingest(csv_bytes(bars), source)
    with pytest.raises(ValueError, match="contain bars"):
        ingest(b"timestamp,open,high,low,close,volume\n", source)


def test_missing_and_wholly_absent_sessions(source):
    _, bars = ingest(csv_bytes([make_bar(0, session="2025-03-10"), make_bar(2, session="2025-03-12")]), source)
    dataset, _ = ingest(csv_bytes(bars), source)
    assert dataset.quality.absent_sessions == ["2025-03-11"]
    assert dataset.quality.missing_bars == 78 * 3 - 2
    assert dataset.row_count == 2


def test_dst_and_early_close(source):
    dataset, bars = ingest(csv_bytes([make_bar(0, session="2025-03-07"), make_bar(0, session="2025-03-10")]), source)
    assert bars[0].timestamp.hour == 14
    assert bars[1].timestamp.hour == 13
    early = [make_bar(i, session="2025-11-28") for i in range(42)]
    dataset, _ = ingest(csv_bytes(early), source)
    assert dataset.quality.missing_bars == 0
    with pytest.raises(ValueError, match="session window"):
        ingest(csv_bytes([make_bar(42, session="2025-11-28")]), source)


def test_adjustment_metadata_and_zero_volume(source):
    with pytest.raises(ValidationError, match="adjustment basis"):
        Source.model_validate(source.model_dump() | {"price_adjustment": "split_adjusted"})
    dataset, _ = ingest(csv_bytes([make_bar(0, volume=0)]), source)
    assert any("Zero-volume" in w for w in dataset.quality.warnings)
    dataset, _ = ingest(csv_bytes([make_bar(0), make_bar(1, o=50, h=51, low=49, c=50)]), source)
    assert dataset.quality.split_suspected


def test_naive_and_end_labeled(source):
    raw = b"timestamp,open,high,low,close,volume\n2025-03-10 09:35,100,101,99,100,1000\n"
    source = Source.model_validate(source.model_dump() | {"timestamp_convention": "bar_end"})
    _, bars = ingest(raw, source)
    assert bars[0].timestamp.hour == 13 and bars[0].timestamp.minute == 30
    assert bars[0].available_at.minute == 35
    with pytest.raises(ValueError, match="mix naive"):
        ingest(raw + b"2025-03-10T09:40:00-04:00,100,101,99,100,1000\n", source)


def test_extended_and_invalid_timezone(source):
    source = Source.model_validate(source.model_dump() | {"session_mode": "extended"})
    raw = b"timestamp,open,high,low,close,volume\n2025-03-10 04:00,100,101,99,100,1000\n"
    dataset, _ = ingest(raw, source)
    assert any("Extended window" in w for w in dataset.quality.warnings)
    source = Source.model_validate(source.model_dump() | {"timezone": "Imaginary/Zone"})
    with pytest.raises(ValueError, match="IANA"):
        ingest(raw, source)
