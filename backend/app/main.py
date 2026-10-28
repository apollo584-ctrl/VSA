import json
import logging
import os
import secrets
import re
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app import alerts, auth, journal, outcomes, setup_a
from app.data import MAX_BYTES, ingest, quality
from app.interpretation import interpret, visible
from app.knowledge import load
from app.models import Analysis, AnalyzeRequest, Bar, Concept, Dataset, JournalEntry, JournalEntryIn, Parameters, Profile, Source, SymbolLoadRequest
from app.profiles import profile, profiles
from app.providers import ProviderUnavailable, YahooChartProvider, http_fetch
from app.scan import Scanner, ScanAutoRequest, ScanResult, ScanRunRequest, ScanSnapshot, ScanStatus
from app.store import Store
from app.study_jobs import AlertJob, DailyAlertTimer, IntradayCollector, JobStatus, StudyRefreshTimer, StudyRunner, is_stale

DAILY_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,15}$")
logger = logging.getLogger("market_intelligence")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False


def launch_stop(script: str):
    """Detached `stop.bat delay`, so this response is sent before the servers go down."""
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    # Doubled outer quotes keep a path with spaces intact under cmd /c.
    subprocess.Popen(f'cmd.exe /d /c ""{script}" delay"', creationflags=flags, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def create_app(db_path: Path | None = None, market_fetch=None, scan_universe: list[dict] | None = None) -> FastAPI:
    fetch = market_fetch or http_fetch
    store = Store(db_path or Path(os.getenv("MSI_DB_PATH", str(Path(__file__).resolve().parents[1] / "data/market.sqlite3"))))

    @asynccontextmanager
    async def lifespan(app):
        store.initialize()
        load()
        if os.getenv("MSI_AUTO_COLLECT") == "1" and is_stale(store.get_meta("last_collected_at")):
            collector.start()
        if os.getenv("MSI_AUTO_COLLECT") == "1":
            alert_timer.start()
            study_timer.start()
        yield
        alert_timer.shutdown()
        study_timer.shutdown()
        scanner.shutdown()
        study_runner.shutdown()
        alert_job.shutdown()
        collector.shutdown()

    scanner = Scanner(store, fetch=fetch, universe=scan_universe)
    study_runner = StudyRunner(store, fetch=fetch, universe=scan_universe)
    collector = IntradayCollector(store, fetch=fetch, universe=scan_universe)
    alert_job = AlertJob(store, fetch=fetch, universe=scan_universe)
    alert_timer = DailyAlertTimer(store, alert_job)
    study_timer = StudyRefreshTimer(store, study_runner)
    app = FastAPI(title="Market Structure Intelligence", version="0.1.0", lifespan=lifespan, dependencies=[Depends(auth.require_auth)])
    app.state.auth_path = auth.auth_path(store.path)
    limiter = auth.LoginLimiter()
    app.state.launch_stop = launch_stop
    app.state.store = store
    app.state.scanner = scanner
    app.state.study_runner = study_runner
    app.state.collector = collector
    app.state.alert_job = alert_job
    origins = os.getenv("MSI_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in origins], allow_credentials=True,
                       allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+):3000$",
                       allow_methods=["GET", "POST", "PUT"], allow_headers=["Content-Type", "X-MSI-Request"], expose_headers=["X-Request-ID", "Retry-After"])

    @app.middleware("http")
    async def protect_docs(request, call_next):
        if request.url.path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect") and not auth.is_local(request):
            if auth.load_pin_file(app.state.auth_path) is None:
                return JSONResponse({"detail": "No PIN is set on the host PC"}, 401)
            if not auth.has_session(request):
                return JSONResponse({"detail": "Login required"}, 401)
        return await call_next(request)

    @app.middleware("http")
    async def log_request(request, call_next):
        request_id = str(uuid4())
        start = time.monotonic()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info(json.dumps({"event": "http_request", "request_id": request_id, "method": request.method,
                                "path": request.url.path, "status": response.status_code,
                                "duration_ms": round((time.monotonic() - start) * 1000, 2)}))
        return response

    def dataset_or_404(dataset_id):
        try:
            return store.dataset(dataset_id)
        except KeyError as exc:
            raise HTTPException(404, "Dataset not found") from exc

    def cutoff(bars, as_of):
        if as_of is not None and (as_of.tzinfo is None or as_of.utcoffset() is None):
            raise HTTPException(422, "as_of requires a UTC offset")
        try:
            return visible(bars, as_of)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok", "engine_version": "0.1.0", "knowledge_version": load().version, "live_data": False}

    @app.get("/api/v1/auth/status")
    def auth_status(request: Request):
        return {"local": auth.is_local(request), "pin_set": auth.load_pin_file(app.state.auth_path) is not None,
                "authenticated": auth.has_session(request)}

    @app.post("/api/v1/auth/login")
    async def auth_login(request: Request, response: Response):
        try:
            pin = (await request.json()).get("pin")
        except (ValueError, AttributeError):
            pin = None
        if not auth.valid_pin(pin):
            raise HTTPException(422, "PIN must be 6 to 12 digits")
        local = auth.is_local(request)
        ip = request.client.host if request.client else "unknown"
        data = auth.load_pin_file(app.state.auth_path)
        if data is None:
            raise HTTPException(401, "No PIN is set on the host PC")
        if not local:
            wait = limiter.attempt(ip)
            if wait:
                raise HTTPException(429, "Too many attempts", headers={"Retry-After": str(wait)})
        if not await run_in_threadpool(auth.verify_pin, data, pin):
            raise HTTPException(401, "Wrong PIN")
        if not local:
            limiter.success(ip)
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        store.create_session(auth.token_hash(token, data), now.isoformat(), (now + timedelta(seconds=auth.SESSION_SECONDS)).isoformat())
        response.set_cookie(auth.COOKIE, token, max_age=auth.SESSION_SECONDS, path="/api/v1", httponly=True, samesite="lax", secure=False)
        return {"authenticated": True}

    @app.post("/api/v1/auth/logout")
    def auth_logout(request: Request, response: Response):
        token = request.cookies.get(auth.COOKIE)
        data = auth.load_pin_file(app.state.auth_path)
        if token and data is not None:
            store.delete_session(auth.token_hash(token, data))
        response.delete_cookie(auth.COOKIE, path="/api/v1")
        return {"authenticated": False}

    @app.post("/api/v1/app/quit")
    def app_quit(request: Request):
        """Quit button: runs stop.bat after a short delay. Host PC only (loopback client and loopback Host), even with a
        PIN session, because the frontend server cannot see the real client address."""
        if not auth.is_local(request) or request.headers.get("x-msi-request") != "1":
            raise HTTPException(403, "Quit is only available on the host PC")
        script = os.getenv("MSI_STOP_SCRIPT")
        if not script:
            raise HTTPException(501, "Quit is only available when the app is started with start.bat.")
        app.state.launch_stop(script)
        return {"stopping": True}

    @app.get("/api/v1/instruments")
    def instruments():
        return {"items": store.instruments()}

    @app.post("/api/v1/datasets/upload", response_model=Dataset, status_code=201)
    async def upload(file: UploadFile = File(...), metadata: str = Form(...)):
        raw = await file.read(MAX_BYTES + 1)
        await file.close()
        try:
            source = Source.model_validate_json(metadata)
            dataset, bars = await run_in_threadpool(ingest, raw, source)
        except (ValueError, ValidationError) as exc:
            raise HTTPException(422, str(exc)) from exc
        await run_in_threadpool(store.save_dataset, dataset, bars, raw)
        return dataset

    @app.post("/api/v1/datasets/from-symbol", response_model=Dataset, status_code=201,
              responses={200: {"model": Dataset, "description": "Identical data already stored; existing dataset returned"}})
    async def load_symbol(request: SymbolLoadRequest, response: Response):
        provider = YahooChartProvider(request.symbol, request.timeframe_minutes, request.period, fetch=fetch)
        try:
            source, raw = await run_in_threadpool(provider.read)
            dataset, bars = await run_in_threadpool(ingest, raw, source)
        except ProviderUnavailable as exc:
            raise HTTPException(502, str(exc)) from exc
        except ValueError as exc:  # includes SymbolNotFound
            raise HTTPException(422, str(exc)) from exc
        dataset, created = await run_in_threadpool(store.save_or_find_dataset, dataset, bars, raw)
        if not created:
            response.status_code = 200
        return dataset

    daily_cache: dict[str, tuple[float, list[dict]]] = {}
    daily_lock = threading.Lock()
    app.state.daily_bars_cache = daily_cache

    @app.get("/api/v1/daily-bars")
    async def daily_bars(symbol: str = Query(...)):
        symbol = symbol.strip().upper()
        if not DAILY_SYMBOL.fullmatch(symbol):
            raise HTTPException(422, "Invalid symbol")
        with daily_lock:
            hit = daily_cache.get(symbol)
        if hit and hit[0] > time.monotonic():
            return {"symbol": symbol, "bars": hit[1]}
        try:
            fetched = await run_in_threadpool(outcomes.fetch_daily, symbol, fetch)
        except ProviderUnavailable as exc:
            raise HTTPException(502, str(exc)) from exc
        except ValueError as exc:  # includes SymbolNotFound
            raise HTTPException(422, str(exc)) from exc
        bars = [{"session": b.session, "open": b.open, "high": b.high, "low": b.low, "close": b.close, "volume": b.volume}
                for b in fetched[-500:]]
        with daily_lock:
            daily_cache[symbol] = (time.monotonic() + 3600, bars)
        return {"symbol": symbol, "bars": bars}

    @app.get("/api/v1/datasets/{dataset_id}", response_model=Dataset)
    def dataset(dataset_id: str):
        return dataset_or_404(dataset_id)[0]

    @app.get("/api/v1/market/bars", response_model=list[Bar])
    def market_bars(dataset_id: str, as_of: datetime | None = None,
                    offset: int = Query(0, ge=0), limit: int = Query(1000, ge=1, le=10000)):
        _, bars = dataset_or_404(dataset_id)
        return cutoff(bars, as_of)[offset:offset + limit]

    @app.get("/api/v1/profiles", response_model=list[Profile])
    def get_profiles(dataset_id: str, as_of: datetime | None = None, bin_size: float = Query(0.25, ge=0.000001, le=10000),
                     value_area_fraction: float = Query(0.7, gt=0, le=1), composite: bool = False):
        dataset, bars = dataset_or_404(dataset_id)
        bars = cutoff(bars, as_of)
        p = Parameters(bin_size=bin_size, value_area_fraction=value_area_fraction,
                       tpo_minutes=max(30, dataset.source.timeframe_minutes))
        try:
            if quality(bars, dataset.source, p).split_suspected:
                raise ValueError("Possible split or large discontinuity: profile calculation blocked")
            return [profile(bars, dataset.source, p, "composite")] if composite else profiles(bars, dataset.source, p)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    def scan_snapshot():
        results = [ScanResult.model_validate_json(raw) for raw in store.scan_results()]
        rank = {"strength": 0, "weakness": 0, "none": 1}
        results.sort(key=lambda r: (r.status == "error", rank[r.direction], -r.agreeing, r.symbol))
        return {"status": scanner.current_status(), "results": results}

    @app.get("/api/v1/scan", response_model=ScanSnapshot)
    def scan():
        return scan_snapshot()

    @app.post("/api/v1/scan/run", response_model=ScanStatus, status_code=202)
    def scan_run(request: ScanRunRequest | None = None):
        status, _ = scanner.start(request.symbols if request else None)
        return status

    @app.post("/api/v1/scan/auto", response_model=ScanStatus)
    def scan_auto(request: ScanAutoRequest):
        status = scanner.set_auto(request.minutes)
        if request.minutes:
            scanner.start()
        return scanner.current_status()

    @app.post("/api/v1/outcomes/run", response_model=JobStatus, status_code=202)
    def outcomes_run(response: Response):
        status, started = study_runner.start()
        if not started:
            response.status_code = 200
        return status

    @app.get("/api/v1/outcomes")
    def outcomes_latest():
        return {"status": study_runner.current_status(), "study": store.latest_study()}

    @app.post("/api/v1/alerts/run", response_model=JobStatus, status_code=202)
    def alerts_run(response: Response):
        status, started = alert_job.start()
        if not started:
            response.status_code = 200
        return status

    @app.get("/api/v1/alerts/status", response_model=JobStatus)
    def alerts_status():
        return alert_job.current_status()

    @app.get("/api/v1/alerts")
    def alerts_list(date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
        session = date or store.get_meta("last_alert_session")
        study = store.latest_study()
        # Study figures come from the study the alert was built on; once that study is replaced they are left out.
        rows = [{**a, **(alerts.study_context(study, a["concept"]) if study and study["generated_at"] == a["study_generated_at"] else {})}
                for a in (store.alerts_for(session) if session else [])]
        return {"session": session, "alerts": rows,
                "last_run": json.loads(store.get_meta("last_alert_run") or "null")}

    @app.get("/api/v1/track-record")
    def track_record_list():
        index = json.loads(store.get_meta("alert_index") or "{}")
        rows = [{**r, "index": index.get(f"{r['symbol']}|{r['session_date']}")} for r in store.alerts_with_outcomes()]
        base = {int(h): v for h, v in json.loads(store.get_meta("alert_baseline") or "{}").items()}
        return {"rows": alerts.track_record(rows, base), "round_trip_cost": alerts.ROUND_TRIP_COST, "min_cases": outcomes.MIN_CASES}

    @app.post("/api/v1/intraday/collect", response_model=JobStatus, status_code=202)
    def intraday_collect(response: Response):
        status, started = collector.start()
        if not started:
            response.status_code = 200
        return status

    @app.get("/api/v1/intraday")
    def intraday():
        return {"status": collector.current_status(), "summary": store.intraday_summary()}

    @app.get("/api/v1/setup-a")
    async def setup_a_check(symbols: str = Query(...)):
        wanted = []
        for raw in symbols.split(","):
            symbol = raw.strip().upper()
            if not DAILY_SYMBOL.fullmatch(symbol):
                raise HTTPException(422, f"Invalid symbol: {raw.strip()!r}")
            if symbol not in wanted:
                wanted.append(symbol)
        if not 1 <= len(wanted) <= 8:
            raise HTTPException(422, "Provide 1 to 8 symbols")
        return await run_in_threadpool(setup_a.check, wanted, fetch)

    def journal_values(entry: JournalEntryIn) -> dict:
        values = entry.model_dump()
        values["r_multiple"] = journal.r_multiple(entry.net_pnl, entry.planned_loss)
        values["rule_breach"] = int(entry.rule_breach)
        return values

    @app.get("/api/v1/journal", response_model=list[JournalEntry])
    def journal_list(date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
        return store.journal_entries(date)

    @app.post("/api/v1/journal", response_model=JournalEntry, status_code=201)
    def journal_add(entry: JournalEntryIn):
        return store.add_journal_entry(journal_values(entry), datetime.now(timezone.utc).isoformat())

    # Registered before the {id} route so "export.csv" and "day-summary" are never read as an id.
    @app.get("/api/v1/journal/export.csv")
    def journal_export():
        return Response(journal.to_csv(store.journal_entries()), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="journal.csv"'})

    @app.get("/api/v1/journal/day-summary")
    def journal_day_summary(date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
        return journal.day_summary(store.journal_entries(date), date)

    @app.put("/api/v1/journal/{entry_id}", response_model=JournalEntry)
    def journal_update(entry_id: int, entry: JournalEntryIn):
        try:
            return store.update_journal_entry(entry_id, journal_values(entry), datetime.now(timezone.utc).isoformat())
        except KeyError as exc:
            raise HTTPException(404, "Journal entry not found") from exc

    @app.get("/api/v1/knowledge/concepts",response_model=list[Concept])
    def concepts(category: str | None = None):
        return [c for c in load().concepts if category is None or c.category == category]

    @app.get("/api/v1/knowledge/concepts/{concept_id}", response_model=Concept)
    def concept(concept_id: str):
        for c in load().concepts:
            if c.id == concept_id:
                return c
        raise HTTPException(404, "Concept not found")

    @app.get("/api/v1/knowledge/concepts/{concept_id}/related", response_model=list[Concept])
    def related(concept_id: str):
        found = concept(concept_id)
        return [c for c in load().concepts if c.id in found.related_patterns]

    @app.post("/api/v1/analyze", response_model=Analysis, status_code=201,
              responses={200: {"model": Analysis, "description": "Non-persisted preview (persist=false)"}})
    def analyze(request: AnalyzeRequest, response: Response):
        dataset, bars = dataset_or_404(request.dataset_id)
        try:
            result = interpret(dataset, bars, request)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if request.persist:
            store.save_analysis(result)
        else:
            response.status_code = 200
        return result

    @app.get("/api/v1/analyses/{analysis_id}", response_model=Analysis)
    def analysis(analysis_id: str):
        try:
            return store.analysis(analysis_id)
        except KeyError as exc:
            raise HTTPException(404, "Analysis not found") from exc

    return app


app = create_app()
