# Market Structure Intelligence backend

First working vertical slice for historical OHLCV interpretation. Requires Python 3.12+. No API keys or LLM needed. The demo is synthetic, not live data. Frontend integration: [API contract](../docs/API_CONTRACT.md). Scope and remaining modules: [product specification](../docs/PRODUCT_SPEC.md).

## Windows PowerShell setup

Run from the repository root:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -e './backend[test]'
Set-Location backend
.venv/Scripts/python.exe -m scripts.demo
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level info
```

If the host's `venv` cannot bootstrap pip, use `python -m venv --without-pip backend/.venv`, then `python -m pip --python backend/.venv/Scripts/python.exe install -e './backend[test]'` from the root. On macOS/Linux use `.venv/bin/python` instead of `.venv/Scripts/python.exe`.

Open `http://127.0.0.1:8000/docs`. Upload `backend/fixtures/demo.csv` with the JSON string from `upload_metadata.json`, then POST `/api/v1/analyze` with the returned dataset ID. `scripts.demo` regenerates CSV, representative frontend JSON and OpenAPI fixtures using a temporary database. It does not populate the development database. Its fixture IDs are fixed mocks.

Analysis saves by default. Send `persist=false` for a write-free replay/preview (HTTP 200, null ID); saved analyses return HTTP 201 and preserve their composite profile. `preview_request.json` and `preview_response.json` illustrate the preview contract. Existing snapshots are not backfilled.

`MSI_DB_PATH` overrides the default `backend/data/market.sqlite3`; `MSI_CORS_ORIGINS` overrides allowed frontend origins. Uvicorn logs requests as JSON via the `market_intelligence` logger; configure that logger at INFO when embedding the app. CSV data is retained in SQLite together with parsed bars, so the database contains uploaded data. Dataset writes and analysis writes are atomic and append-only.

## Checks and reproducibility

Tests use temporary databases and deterministic inputs, with no persistent runtime mutations. Run from `backend/` using `python -m pytest -q`. `requirements.lock.txt` records the tested Python 3.13 Windows environment (runtime and test packages). For matching versions from the repository root, install using `python -m pip install -c backend/requirements.lock.txt -e './backend[test]'`; this is a constraints file, not a portable binary lock. The knowledge catalog is checked in; only run `python -m scripts.build_knowledge` when deliberately regenerating it.

This local MVP has no authentication or public deployment configuration. No tests establish predictive trading accuracy. Catalog-only detectors and incomplete analysis features are listed explicitly in the product specification.
