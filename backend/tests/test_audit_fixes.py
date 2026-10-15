import csv
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest

from app.models import Parameters
from app.profiles import profile
from app.scan import Scanner, ScanResult, WORKERS
from app.value_path import developing_profile
from tests.conftest import make_bar
from tests.test_api import upload
from tests.test_symbol_load import chart, fetcher, make_client


@pytest.mark.parametrize('field,value', [('exchangeName', 'LSE'), ('exchangeTimezoneName', 'Europe/London'), ('instrumentType', 'CRYPTOCURRENCY'), ('exchangeName', None)])
def test_unsupported_market_never_stores(make_client, field, value):
    payload = chart()
    payload['chart']['result'][0]['meta'][field] = value
    client = make_client(fetcher(payload))
    assert client.post('/api/v1/datasets/from-symbol', json={'symbol': 'SPY'}).status_code == 502
    assert client.get('/api/v1/instruments').json()['items'] == []


def test_concurrent_imports_reuse_dataset(make_client, monkeypatch):
    client = make_client(fetcher(chart()))
    store = client.app.state.store
    original = store.save_or_find_dataset
    barrier = threading.Barrier(2)
    def simultaneous(*args):
        barrier.wait(timeout=10)
        return original(*args)
    monkeypatch.setattr(store, 'save_or_find_dataset', simultaneous)
    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(lambda _: client.post('/api/v1/datasets/from-symbol', json={'symbol': 'SPY'}), range(2)))
    assert sorted(r.status_code for r in responses) == [200, 201]
    assert responses[0].json() == responses[1].json()
    with store.connect() as db:
        assert db.execute('SELECT COUNT(*) FROM datasets').fetchone()[0] == 1


@pytest.mark.parametrize('raw', [b'x' * (csv.field_size_limit() + 1), b'timestamp,open,high,low,close,volume\n' + b'x' * (csv.field_size_limit() + 1), b'timestamp,open,high,low,close,volume\n"unterminated'], ids=['oversized-header', 'oversized-cell', 'bad-quote'])
def test_csv_parser_errors_are_validation_errors(client, raw):
    assert upload(client, raw).status_code == 422
    assert client.get('/api/v1/instruments').json()['items'] == []


def test_shutdown_drains_active_workers_skips_queue_and_prevents_restart():
    class Store:
        saved = []
        def save_scan_result(self, result):
            self.saved.append(result)
    store = Store()
    scanner = Scanner(store, universe=[{'symbol': str(i), 'name': str(i), 'sector': 'test'} for i in range(12)])
    entered = threading.Barrier(WORKERS + 1)
    release = threading.Event()
    calls = []
    def scan(item):
        calls.append(item['symbol'])
        entered.wait(timeout=10)
        assert release.wait(10)
        return ScanResult(**item, status='ok', scanned_at=datetime.now(UTC))
    scanner.scan_one = scan
    scanner.start()
    entered.wait(timeout=10)
    with ThreadPoolExecutor(1) as pool:
        shutdown = pool.submit(scanner.shutdown)
        try:
            assert scanner._stopping.wait(5)
            assert not shutdown.done()
            assert scanner.start()[1] is False
        finally:
            release.set()
        shutdown.result(timeout=10)
    assert len(calls) == WORKERS and store.saved == []
    assert not scanner.current_status().running
    assert scanner.set_auto(15).auto_minutes == 0
    scanner.shutdown()


@pytest.mark.parametrize('bin_size', [0.1, 0.25, 1.0])
def test_incremental_profile_matches_every_prefix_when_range_expands(source, bin_size):
    p = Parameters(bin_size=bin_size)
    bars = [make_bar(i, low=100-i*.1, h=100+i*.2, o=100, c=100, volume=0 if i < 2 else 1000+i) for i in range(25)]
    path = developing_profile(bars, source, p)
    expected = []
    for k in range(len(bars)):
        volume = profile(bars[:k+1], source, p).volume
        if volume.poc is not None:
            expected.append((volume.poc, volume.val, volume.vah))
    assert [(x.poc, x.val, x.vah) for x in path.points] == expected
