from datetime import timedelta

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Bar, Source


@pytest.fixture
def source():
    return Source(instrument="TEST", price_adjustment="unadjusted", volume_adjustment="raw", source_name="test")


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "test.sqlite3")) as result:
        yield result


def make_bar(index, *, session="2025-03-10", o=100, h=101, low=99, c=100, volume=1000):
    stamp = (pd.Timestamp(session + " 09:30", tz="America/New_York") + pd.Timedelta(minutes=index * 5)).to_pydatetime()
    return Bar(timestamp=stamp, available_at=stamp + timedelta(minutes=5), session=session,
               open=o, high=h, low=low, close=c, volume=volume)


def csv_bytes(bars):
    rows = ["timestamp,open,high,low,close,volume"]
    rows.extend(f"{b.timestamp.isoformat()},{b.open},{b.high},{b.low},{b.close},{b.volume}" for b in bars)
    return ("\n".join(rows) + "\n").encode()
