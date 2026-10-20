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
                CREATE TABLE IF NOT EXISTS study_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS intraday_bars (
                    symbol TEXT NOT NULL, ts TEXT NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
                    close REAL NOT NULL, volume REAL NOT NULL, basis INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (symbol, ts, basis));
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
            """)

    def create_session(self, token_hash: str, created_at: str, expires_at: str):
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE expires_at <= ?", (created_at,))
            db.execute("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)", (token_hash, created_at, expires_at))

    def session_valid(self, token_hash: str) -> bool:
        from datetime import datetime, timezone
        with self.connect() as db:
            row = db.execute("SELECT 1 FROM sessions WHERE token_hash=? AND expires_at > ?",
                             (token_hash, datetime.now(timezone.utc).isoformat())).fetchone()
        return row is not None

    def clear_sessions(self):
        with self.connect() as db:
            db.execute("DELETE FROM sessions")

    def delete_session(self, token_hash: str):
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))

    def save_study(self, study: dict):
        with self.connect() as db:
            db.execute("INSERT INTO study_runs (created_at, payload) VALUES (?, ?)", (study["generated_at"], json.dumps(study, allow_nan=False)))

    def latest_study(self):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM study_runs ORDER BY id DESC LIMIT 1").fetchone()
        return json.loads(row[0]) if row else None

    def save_intraday_bars(self, symbol: str, bars: list[Bar]) -> int:
        """Insert bars never seen before; existing rows are never overwritten. Returns rows added.

        If incoming closes differ from stored ones (split/adjustment) by more than 0.1%, a new basis starts and the bars go under it.
        """
        with self.connect() as db:
            basis = db.execute("SELECT COALESCE(MAX(basis), 0) FROM intraday_bars WHERE symbol=?", (symbol,)).fetchone()[0]
            stored = dict(db.execute("SELECT ts, close FROM intraday_bars WHERE symbol=? AND basis=?", (symbol, basis)))
            for b in bars:
                old = stored.get(b.timestamp.isoformat())
                if old is not None and abs(b.close - old) > 0.001 * abs(old):
                    basis += 1
                    break
            before = db.total_changes
            db.executemany("INSERT OR IGNORE INTO intraday_bars VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                           [(symbol, b.timestamp.isoformat(), b.open, b.high, b.low, b.close, b.volume, basis) for b in bars])
            return db.total_changes - before

    def intraday_summary(self):
        with self.connect() as db:
            symbols, count, first, last = db.execute(
                "SELECT COUNT(DISTINCT symbol), COUNT(*), MIN(ts), MAX(ts) FROM intraday_bars b "
                "WHERE basis = (SELECT MAX(basis) FROM intraday_bars WHERE symbol = b.symbol)").fetchone()
            rebased = db.execute("SELECT COUNT(DISTINCT symbol) FROM intraday_bars WHERE basis > 0").fetchone()[0]
        return {"symbols": symbols, "bars": count, "first_ts": first, "last_ts": last, "rebased_symbols": rebased,
                "last_collected_at": self.get_meta("last_collected_at")}

    def get_meta(self, key: str):
        with self.connect() as db:
            row = db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (key, value))

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

    def save_or_find_dataset(self, dataset: Dataset, bars: list[Bar], raw: bytes):
        """Serialize lookup and insertion across connections, including separate app instances."""
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("SELECT metadata FROM datasets WHERE metadata LIKE ?",
                              (f'%"{dataset.content_sha256}"%',)).fetchall()
            for row in rows:
                found = Dataset.model_validate_json(row[0])
                if found.content_sha256 == dataset.content_sha256 and found.source == dataset.source:
                    return found, False
            db.execute("INSERT INTO datasets VALUES (?, ?, ?, ?)", (
                dataset.id, dataset.model_dump_json(),
                json.dumps([bar.model_dump(mode="json") for bar in bars], allow_nan=False), raw))
            return dataset, True

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
