"""S&P 500 confluence scanner: loads recent bars per symbol, runs the normal analysis, and flags aligned strength or weakness.

Nothing here changes detector rules. A symbol is flagged only when independent readings from the existing analysis agree.
Scans use the unofficial Yahoo chart endpoint (see providers.py) and never persist datasets or snapshots.
"""
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.data import ingest
from app.interpretation import interpret
from app.models import Analysis, AnalyzeRequest
from app.providers import ProviderUnavailable, YahooChartProvider, http_fetch

logger = logging.getLogger("market_intelligence")
UNIVERSE_PATH = Path(__file__).parent / "universe" / "sp500.json"
MIN_AGREEING = 3  # of 4 readings, with none opposed
WORKERS = 4

UP_STATES = {"higher_price_acceptance", "rejection_below_value"}
DOWN_STATES = {"lower_price_acceptance", "rejection_above_value"}


class ScanModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ScanVote(ScanModel):
    factor: Literal["value_location", "auction_state", "vsa", "price_action"]
    vote: Literal[-1, 0, 1]
    text: str


class ScanResult(ScanModel):
    symbol: str
    name: str
    sector: str
    status: Literal["ok", "error"]
    direction: Literal["strength", "weakness", "none"] = "none"
    agreeing: int = 0
    votes: list[ScanVote] = []
    last_close: float | None = None
    last_bar_at: datetime | None = None
    scanned_at: datetime
    error: str | None = None


class ScanStatus(ScanModel):
    running: bool
    started_at: datetime | None = None
    finished_at: datetime | None = None
    total: int = 0
    done: int = 0
    auto_minutes: int = 0
    universe_size: int = 0


class ScanSnapshot(ScanModel):
    status: ScanStatus
    results: list[ScanResult]


class ScanRunRequest(ScanModel):
    symbols: list[str] | None = None


class ScanAutoRequest(ScanModel):
    minutes: Literal[0, 15, 30, 60]


def load_universe() -> list[dict]:
    return json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))["constituents"]


def confluence(a: Analysis) -> tuple[str, int, list[ScanVote]]:
    """Four readings, each -1 (weakness), 0 or +1 (strength). Flag only when >= MIN_AGREEING agree and none oppose."""
    votes = []
    loc = a.value_location
    if loc is not None and loc.state != "unavailable":
        v = 1 if loc.state == "above_value" else -1 if loc.state == "below_value" else 0
        votes.append(ScanVote(factor="value_location", vote=v, text=f"Close {loc.price:g} is {loc.state.replace('_', ' ')} (prior {loc.val:g}–{loc.vah:g})"))
    state = a.auction_state.state
    if state != "indeterminate":
        votes.append(ScanVote(factor="auction_state", vote=1 if state in UP_STATES else -1 if state in DOWN_STATES else 0, text=f"Auction state: {state.replace('_', ' ')}"))
    session_start = next((r.timestamp for r in reversed(a.auction_state.session_resets or [])), None)
    def current(items):
        return [o for o in items if session_start is None or o.timestamp >= session_start]
    vsa = [o for o in current(a.vsa_observations) if o.status in ("provisional", "confirmed")]
    s, w = sum(o.direction == "strength" for o in vsa), sum(o.direction == "weakness" for o in vsa)
    if s or w:
        votes.append(ScanVote(factor="vsa", vote=1 if s > w else -1 if w > s else 0, text=f"Active VSA this session: {s} strength, {w} weakness"))
    pa = current([o for o in a.price_action_observations if o.concept_id != "swing_structure"])
    s, w = sum(o.direction == "strength" for o in pa), sum(o.direction == "weakness" for o in pa)
    if s or w:
        votes.append(ScanVote(factor="price_action", vote=1 if s > w else -1 if w > s else 0, text=f"Price action this session: {s} strength, {w} weakness"))
    up, down = sum(v.vote > 0 for v in votes), sum(v.vote < 0 for v in votes)
    if up >= MIN_AGREEING and down == 0:
        return "strength", up, votes
    if down >= MIN_AGREEING and up == 0:
        return "weakness", down, votes
    return "none", max(up, down), votes


class Scanner:
    def __init__(self, store, fetch=None, universe: list[dict] | None = None):
        self.store, self.fetch = store, fetch or http_fetch
        self.universe = universe if universe is not None else load_universe()
        self.lock = threading.Lock()
        self.status = ScanStatus(running=False, universe_size=len(self.universe))
        self._auto_stop = threading.Event()
        self._auto_thread: threading.Thread | None = None
        self._thread: threading.Thread | None = None

    def current_status(self) -> ScanStatus:
        with self.lock:
            return self.status.model_copy()

    def start(self, symbols: list[str] | None = None) -> tuple[ScanStatus, bool]:
        """Begin a scan in the background. Returns (status, started); a scan already running is left alone."""
        wanted = {s.strip().upper() for s in symbols} if symbols else None
        targets = [c for c in self.universe if wanted is None or c["symbol"] in wanted]
        with self.lock:
            if self.status.running:
                return self.status.model_copy(), False
            self.status = self.status.model_copy(update={"running": True, "started_at": datetime.now(UTC), "finished_at": None, "total": len(targets), "done": 0})
        self._thread = threading.Thread(target=self._run, args=(targets,), daemon=True)
        self._thread.start()
        return self.current_status(), True

    def wait(self, timeout: float = 30):
        if self._thread:
            self._thread.join(timeout)

    def scan_one(self, item: dict) -> ScanResult:
        now = datetime.now(UTC)
        base = dict(symbol=item["symbol"], name=item["name"], sector=item["sector"], scanned_at=now)
        try:
            source, raw = YahooChartProvider(item["symbol"], fetch=self.fetch).read()
            dataset, bars = ingest(raw, source)
            analysis = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, persist=False))
            direction, agreeing, votes = confluence(analysis)
            return ScanResult(**base, status="ok", direction=direction, agreeing=agreeing, votes=votes,
                              last_close=bars[-1].close, last_bar_at=bars[-1].available_at)
        except (ProviderUnavailable, ValueError) as exc:
            return ScanResult(**base, status="error", error=str(exc)[:200])
        except Exception as exc:  # one bad symbol must never stop the scan
            logger.warning(json.dumps({"event": "scan_symbol_failed", "symbol": item["symbol"], "error": repr(exc)[:200]}))
            return ScanResult(**base, status="error", error="Unexpected analysis failure")

    def _run(self, targets: list[dict]):
        def work(item):
            result = self.scan_one(item)
            self.store.save_scan_result(result)
            with self.lock:
                self.status = self.status.model_copy(update={"done": self.status.done + 1})
        try:
            with ThreadPoolExecutor(WORKERS) as pool:
                list(pool.map(work, targets))
        finally:
            with self.lock:
                self.status = self.status.model_copy(update={"running": False, "finished_at": datetime.now(UTC)})

    def set_auto(self, minutes: int) -> ScanStatus:
        self._auto_stop.set()
        self._auto_stop = stop = threading.Event()
        with self.lock:
            self.status = self.status.model_copy(update={"auto_minutes": minutes})
        if minutes:
            def loop():
                while not stop.wait(minutes * 60):
                    self.start()
            self._auto_thread = threading.Thread(target=loop, daemon=True)
            self._auto_thread.start()
        return self.current_status()

    def shutdown(self):
        self._auto_stop.set()
