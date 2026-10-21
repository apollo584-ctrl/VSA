"""Background jobs: the daily-bar outcome study and the free 30-minute history saver.

Both follow the Scanner pattern (one run at a time, status under a lock, clean shutdown) and use the unofficial Yahoo chart endpoint.
"""
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict

from app import alerts, outcomes
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


NY = ZoneInfo("America/New_York")


def expected_session(now: datetime | None = None) -> str:
    """Latest US session that should be finished by now (weekdays after 16:30 New York; holidays are not modelled)."""
    t = (now or datetime.now(UTC)).astimezone(NY)
    d = t.date() if t.time() >= time(16, 30) else t.date() - timedelta(days=1)
    while d.weekday() > 4:
        d -= timedelta(days=1)
    return d.isoformat()


class AlertJob(StudyRunner):
    """Daily alerts for the newest session plus scoring of every open alert. Bars stay in memory for the run only."""

    def finish(self):
        with self.lock:
            symbol_bars = {s: b for s, b in self.symbol_bars.items() if b}
        study = self.store.latest_study()
        if not study:
            raise ValueError("No outcome study yet; run the study first")
        if not symbol_bars:
            raise ValueError("No daily bars fetched")
        session = max(b[-1].session for b in symbol_bars.values())
        now = datetime.now(UTC).isoformat()
        previous = self.store.get_meta("last_alert_session")
        # Rebuilt on every run for the newest session: INSERT OR IGNORE keeps existing alerts unchanged, and symbols
        # that failed to fetch on an earlier run still get their alerts.
        added = self.store.save_alerts(alerts.build_alerts(symbol_bars, study, session), now)
        self.store.set_meta("last_alert_session", session)
        gap = previous if previous and previous != session else None
        scored = 0
        for a in self.store.open_alerts():
            if a["symbol"] in symbol_bars:
                scored += self.store.save_alert_outcomes(a["id"], alerts.score(a, symbol_bars[a["symbol"]]), now)
        sessions = {a["session_date"] for a in self.store.alerts_with_outcomes()} | {a["session_date"] for a in self.store.alerts_for(session)}
        index = json.loads(self.store.get_meta("alert_index") or "{}")
        base = {h: [] for h in outcomes.HORIZONS}
        for symbol, bars in symbol_bars.items():
            pos = {b.session: i for i, b in enumerate(bars)}
            index.update({f"{symbol}|{s}": pos[s] for s in sessions if s in pos})
            for r in outcomes.baseline_rows(bars, symbol):
                if r["date"] in sessions:
                    base[r["horizon"]].append(r["return"])
        self.store.set_meta("alert_index", json.dumps(index))
        self.store.set_meta("alert_baseline", json.dumps(base))
        run = json.loads(self.store.get_meta("last_alert_run") or "{}")
        skipped = weekdays_between(gap, session) if gap else run.get("skipped_sessions", 0) if run.get("session") == session else 0
        self.store.set_meta("last_alert_run", json.dumps({"at": now, "session": session, "added": added, "scored": scored,
                                                          "previous_session": gap or (run.get("previous_session") if run.get("session") == session else None),
                                                          "skipped_sessions": skipped, "fetch_errors": self.current_status().errors}))


def weekdays_between(start: str, end: str) -> int:
    """Weekdays strictly between two session dates: sessions with no alerts logged (holidays count, so it can overstate)."""
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return sum(1 for k in range(1, (b - a).days) if (a + timedelta(days=k)).weekday() < 5)


class DailyAlertTimer:
    """Checks every 30 minutes and starts the alert job once per expected session."""
    MAX_ATTEMPTS = 3

    def __init__(self, store, job: AlertJob, every: float = 1800):
        self.store, self.job, self.every = store, job, every
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def start(self):
        self._thread.start()

    def check(self, now: datetime | None = None) -> bool:
        """Starts the job until the expected session is logged, at most MAX_ATTEMPTS times per session (a holiday never
        produces its session, and a busy job does not use up an attempt)."""
        target = expected_session(now)
        tries = json.loads(self.store.get_meta("last_alert_attempt") or "{}")
        n = tries.get("n", 0) if tries.get("session") == target else 0
        last = json.loads(self.store.get_meta("last_alert_run") or "{}")
        complete = self.store.get_meta("last_alert_session") == target and not last.get("fetch_errors")
        if complete or n >= self.MAX_ATTEMPTS:
            return False
        started = self.job.start()[1]
        if started:
            self.store.set_meta("last_alert_attempt", json.dumps({"session": target, "n": n + 1}))
        return started

    def _loop(self):
        while not self._stop.is_set():
            try:
                self.check()
            except Exception as exc:
                logger.warning(json.dumps({"event": "alert_timer_failed", "error": repr(exc)[:200]}))
            self._stop.wait(self.every)

    def shutdown(self):
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join()


class IntradayCollector(Job):
    def process(self, item):
        source, raw = YahooChartProvider(item["symbol"], 30, period="60d", fetch=self.fetch).read()
        _, bars = ingest(raw, source)
        return {"bars_added": self.store.save_intraday_bars(item["symbol"], bars)}

    def finish(self):
        status = self.current_status()
        if status.done > status.errors:
            self.store.set_meta("last_collected_at", datetime.now(UTC).isoformat())
