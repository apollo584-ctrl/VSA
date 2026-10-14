import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from app.data import MAX_BYTES, ingest, quality
from app.interpretation import interpret, visible
from app.knowledge import load
from app.models import Analysis, AnalyzeRequest, Bar, Concept, Dataset, Parameters, Profile, Source
from app.profiles import profile, profiles
from app.store import Store

logger = logging.getLogger("market_intelligence")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False


def create_app(db_path: Path | None = None) -> FastAPI:
    store = Store(db_path or Path(os.getenv("MSI_DB_PATH", str(Path(__file__).resolve().parents[1] / "data/market.sqlite3"))))

    @asynccontextmanager
    async def lifespan(app):
        store.initialize()
        load()
        yield

    app = FastAPI(title="Market Structure Intelligence", version="0.1.0", lifespan=lifespan)
    app.state.store = store
    origins = os.getenv("MSI_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in origins],
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"], expose_headers=["X-Request-ID"])

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

    @app.get("/api/v1/knowledge/concepts", response_model=list[Concept])
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

    @app.post("/api/v1/analyze", response_model=Analysis, status_code=201)
    def analyze(request: AnalyzeRequest):
        dataset, bars = dataset_or_404(request.dataset_id)
        try:
            result = interpret(dataset, bars, request)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        store.save_analysis(result)
        return result

    @app.get("/api/v1/analyses/{analysis_id}", response_model=Analysis)
    def analysis(analysis_id: str):
        try:
            return store.analysis(analysis_id)
        except KeyError as exc:
            raise HTTPException(404, "Analysis not found") from exc

    return app


app = create_app()
