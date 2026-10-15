"""Immutable datasets and analysis snapshots; one transaction per insert."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from app.models import Analysis, Bar, Dataset


class Store:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS datasets (
                    id TEXT PRIMARY KEY, metadata TEXT NOT NULL, bars TEXT NOT NULL,
                    source_csv BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS analyses (
                    id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES datasets(id),
                    snapshot TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS scan_results (
                    symbol TEXT PRIMARY KEY, scanned_at TEXT NOT NULL, payload TEXT NOT NULL);
            """)

    def save_scan_result(self, result):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO scan_results VALUES (?, ?, ?)", (result.symbol, result.scanned_at.isoformat(), result.model_dump_json()))

    def scan_results(self):
        with self.connect() as db:
            return [row[0] for row in db.execute("SELECT payload FROM scan_results").fetchall()]

    def save_dataset(self, dataset: Dataset, bars: list[Bar], raw: bytes):
        with self.connect() as db:
            db.execute("INSERT INTO datasets VALUES (?, ?, ?, ?)", (
                dataset.id, dataset.model_dump_json(),
                json.dumps([bar.model_dump(mode="json") for bar in bars], allow_nan=False), raw))

    def dataset(self, dataset_id: str):
        with self.connect() as db:
            row = db.execute("SELECT metadata, bars FROM datasets WHERE id=?", (dataset_id,)).fetchone()
        if row is None:
            raise KeyError(dataset_id)
        return Dataset.model_validate_json(row[0]), [Bar.model_validate(b) for b in json.loads(row[1])]

    def find_dataset(self, content_sha256: str, source) -> Dataset | None:
        """An identical import (same bytes and provenance) is reused rather than stored twice."""
        with self.connect() as db:
            rows = db.execute("SELECT metadata FROM datasets WHERE metadata LIKE ?", (f'%"{content_sha256}"%',)).fetchall()
        for row in rows:
            found = Dataset.model_validate_json(row[0])
            if found.content_sha256 == content_sha256 and found.source == source:
                return found
        return None

    def instruments(self):
        with self.connect() as db:
            rows = db.execute("SELECT metadata FROM datasets ORDER BY id").fetchall()
        instruments: dict[str, list[str]] = {}
        for row in rows:
            dataset = Dataset.model_validate_json(row[0])
            instruments.setdefault(dataset.source.instrument, []).append(dataset.id)
        return [{"instrument": symbol, "dataset_ids": ids} for symbol, ids in sorted(instruments.items())]

    def save_analysis(self, analysis: Analysis):
        if not analysis.persisted or analysis.id is None:
            raise ValueError("A preview cannot be stored as a saved analysis")
        with self.connect() as db:
            db.execute("INSERT INTO analyses VALUES (?, ?, ?)", (
                analysis.id, analysis.dataset_id, analysis.model_dump_json()))

    def analysis(self, analysis_id: str):
        with self.connect() as db:
            row = db.execute("SELECT snapshot FROM analyses WHERE id=?", (analysis_id,)).fetchone()
        if row is None:
            raise KeyError(analysis_id)
        return Analysis.model_validate_json(row[0])
