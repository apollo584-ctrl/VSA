"""Background jobs: the daily-bar outcome study and the free 30-minute history saver.

Both follow the Scanner pattern (one run at a time, status under a lock, clean shutdown) and use the unofficial Yahoo chart endpoint.
"""
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, ConfigDict

from app import outcomes
from app.data import ingest
from app.providers import YahooChartProvider, http_fetch
from app.scan import WORKERS, load_universe

logger = logging.getLogger("market_intelligence")
STALE_AFTER = timedelta(days=3)


class JobStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    running: bool = False
    started_at: datetime | None = None
    finished_at: datetime | None = None
    total: int = 0
    done: int = 0
    errors: int = 0
    bars_added: int = 0
    error: str | None = None


def is_stale(last_collected_at: str | None, now: datetime | None = None) -> bool:
    if not last_collected_at:
        return True
    try:
        last = datetime.fromisoformat(last_collected_at)
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=UTC)
    return (now or datetime.now(UTC)) - last > STALE_AFTER


class Job:
    def __init__(self, store, fetch=None, universe: list[dict] | None = None):
        self.store, self.fetch = store, fetch or http_fetch
        self.universe = universe if universe is not None else load_universe()
        self.lock = threading.Lock()
        self.status = JobStatus()
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None

    def current_status(self) -> JobStatus:
        with self.lock:
            return self.status.model_copy()

    def start(self) -> tuple[JobStatus, bool]:
        """Begin a run in the background. Returns (status, started); a run already going is left alone."""
        with self.lock:
            if self.status.running or self._stopping.is_set():
                return self.status.model_copy(), False
            self.status = JobStatus(running=True, started_at=datetime.now(UTC), total=len(self.universe))
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()
        return self.current_status(), True

    def wait(self, timeout: float = 30):
        if self._thread:
            self._thread.join(timeout)

    def _bump(self, **add):
        self.status = self.status.model_copy(update={k: getattr(self.status, k) + v for k, v in add.items()})

    def process(self, item: dict) -> dict:
        raise NotImplementedError

    def finish(self):
        pass

    def _run(self):
        def work(item):
            if self._stopping.is_set():
                return
            try:
                add = self.process(item)
            except Exception as exc:  # one bad symbol must never stop the run
                logger.warning(json.dumps({"event": f"{type(self).__name__}_symbol_failed", "symbol": item["symbol"], "error": repr(exc)[:200]}))
                add = {"errors": 1}
            with self.lock:
                if not self._stopping.is_set():
                    self._bump(done=1, **add)
        error = None
        try:
            with ThreadPoolExecutor(WORKERS) as pool:
                list(pool.map(work, self.universe))
            if not self._stopping.is_set():
                self.finish()
        except Exception as exc:
            error = repr(exc)[:200]
            logger.warning(json.dumps({"event": f"{type(self).__name__}_failed", "error": error}))
        finally:
            with self.lock:
                self.status = self.status.model_copy(update={"running": False, "finished_at": datetime.now(UTC), "error": error})

    def shutdown(self):
        with self.lock:
            self._stopping.set()
            worker = self._thread
        if worker:
            worker.join()


class StudyRunner(Job):
    def __init__(self, store, fetch=None, universe=None, daily=outcomes.fetch_daily):
        super().__init__(store, fetch, universe)
        self.daily, self.symbol_bars = daily, {}

    def start(self):
        with self.lock:
            if not self.status.running:
                self.symbol_bars = {}
        return super().start()

    def process(self, item):
        bars = self.daily(item["symbol"], self.fetch)
        with self.lock:
            self.symbol_bars[item["symbol"]] = bars
        return {}

    def finish(self):
        with self.lock:
            symbol_bars = dict(self.symbol_bars)
        if symbol_bars:
            self.store.save_study(outcomes.run_study(symbol_bars))


class IntradayCollector(Job):
    def process(self, item):
        source, raw = YahooChartProvider(item["symbol"], 30, period="60d", fetch=self.fetch).read()
        _, bars = ingest(raw, source)
        return {"bars_added": self.store.save_intraday_bars(item["symbol"], bars)}

    def finish(self):
        status = self.current_status()
        if status.done > status.errors:
            self.store.set_meta("last_collected_at", datetime.now(UTC).isoformat())
