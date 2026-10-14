# Backend integration

The frontend talks to the Codex backend exactly as documented in `docs/API_CONTRACT.md` (engine 0.1.0, knowledge 1.0.0).
This file replaces the earlier `FRONTEND_API_REQUIREMENTS.md` (written before the backend contract existed).

```
NEXT_PUBLIC_API_MODE=http
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1     # includes /api/v1
```

The backend's default CORS origins are `http://localhost:3000` and `http://127.0.0.1:3000`; run `npm run dev` on port 3000
or set `MSI_CORS_ORIGINS`.

## Where the code lives

| File | Role |
|---|---|
| `lib/api/backend/schemas.ts` | Zod mirror of `backend/app/models.py` (raw responses) |
| `lib/api/backend/mappers.ts` | Pure functions: raw responses → the UI's internal types. No analytics. |
| `lib/api/backend/client.ts` | Endpoints, pagination, caches, error mapping |
| `lib/api/client.ts` | Mock vs http switch; every result is validated against the UI schemas |

Flow implemented: **upload** (`POST /datasets/upload`, Settings → Upload dataset) → **bars** (`GET /market/bars`, paginated
at 10 000) → **analysis** (`POST /analyze`, `as_of` for replay) → **saved snapshot** (`GET /analyses/{id}`, route
`/snapshot/{id}`; the snapshot id is shown under the chart and recorded in Analysis History).

Analysis requests supply `parameters.tpo_minutes = max(30, dataset.timeframe_minutes)`, including 60-minute extended-session datasets.
During replay debounce, pending requests, failed requests or selection changes, prior analytical content is withheld in full. Chart bars can remain visible at the selected cutoff, but profiles, explanations and snapshot links are shown only for the matching selection.

New backend snapshots include `knowledge_snapshot` (the catalog version and its concepts at creation). Analysis mapping uses only that preserved catalog when its version matches `knowledge_version`; it does not fetch the current catalog to enrich a saved result. Legacy snapshots still show their stored observations and scenarios, with an explicit notice that generic concept explanations are unavailable. The Knowledge Explorer separately browses the current catalog.

## Principles preserved

- **Observation** (measured numbers, `kind=observed`) vs **classification** (`kind=classified`, shown with a "Rule classification"
  badge) vs **hypothesis** (`interpretations`, `alternative_scenarios`, concept `possible_interpretations`; dashed/tinted, "Hypothesis"
  badge) vs **uncertainty** (`uncertainties` + data-quality gaps; its own section). Evidence ids in scenarios are resolved to the
  evidence they reference; unresolvable ids are shown as unresolved, never dropped.
- `estimated=true` / `method` on every profile → "Estimated Profile" badge; the method string is shown.
- `direction` (`strength`/`weakness`/`neutral`) is shown as "context: …" with the note that it is not a trade instruction.
- Nothing is invented. A field the backend does not provide is shown as "not provided", not filled in.

## Time convention

The UI addresses a bar by its **start** time. The backend filters on `available_at` (bar **end**). Mapping:

- replay cursor `T` (bar start) → request `as_of = available_at` of that bar;
- `first_observable_at − bar interval` → `detectedAt`; `analysis_timestamp − interval` → `asOf`.

So an observation first observable at the end of the bar starting at `T` is known at cursor `T`, never earlier.

## Contract mismatches / gaps (reported, not papered over)

| # | Frontend need (spec) | Backend today | Frontend handling |
|---|---|---|---|
| 1 | Instrument search / symbol list | Only uploaded datasets; `/instruments` returns ids only | Datasets are the "instruments"; label built from `GET /datasets/{id}`. Dates come from bars' `session`. |
| 2 | Timeframe/session switching | One fixed interval per dataset; no resampling | Selector offers only the dataset's own interval/session. |
| 3 | `GET /profiles` composite not in `Analysis` snapshot | Composite is a separate recompute | Fetched live; **not part of the saved snapshot** (a reopened snapshot has no composite). Request: include composite in the snapshot, or make it addressable by analysis id. |
| 4 | Developing profile (POC/VAH/VAL path) | Not provided | "Developing" tab disabled. |
| 5 | Value location (above/inside/below prior value) | Not provided (auction uses it internally) | Shown as "Not classified" with last close and prior VAH/POC/VAL as supplied. No UI-side classification. |
| 6 | Value migration | Listed as future work (PRODUCT_SPEC) | Table of each session's own POC/VAH/VAL (raw facts, no migration label). |
| 7 | Per-observation "why identified" (which conditions held) | Only concept-level `observable_conditions`; `description` is generic | Shown from the preserved catalog as "Rule conditions (from the knowledge catalog)" with the note that per-condition results are not reported. Unavailable for legacy snapshots without preserved knowledge. Suggest: add `conditions_met` to Evidence. |
| 8 | Evidence-specific implications/alternatives/confirmation/invalidation | Concept-level only | From the preserved catalog, labelled "Generic for this concept"; explicitly unavailable when no matching preserved catalog exists. |
| 9 | Price location of an observation (e.g. above prior VAH) | Not provided on Evidence | "not provided by the engine". |
| 10 | Status history | Final `status`, `first_observable_at`, `confirmed_at`, `measurements.resolved_at` | History built only from those timestamps; `invalidated`/`expired` without `resolved_at` get no timestamp. |
| 11 | Why-it-matters, price-action narrative, scenario "challenged by" | Not provided (`plain_english_summary` + scenarios only) | `whyItMatters` = "Not provided"; price-action/VSA/context lines are plain facts derived from supplied fields; `challengedBy` empty. |
| 12 | Auction timeline | `auction_state` has transitions only (state resets silently each session) | Historical states end at their session's last visible bar. A final state without current-session transition evidence is shown only at the analysis cutoff, marked as such; no reset transition or earlier detection time is invented. |
| 13 | Profile shape confidence | Only `ambiguity` low/high (always high so far) | Ambiguity badge; no percentage. |
| 14 | Nine concepts are `knowledge_only` (e.g. shakeout, volume_divergence) | Never emitted | Knowledge Explorer badges them "knowledge only — no detector". |
| 15 | Non-persisting replay/preview | Every `POST /analyze` persists an immutable snapshot with no delete | Each replay step creates a snapshot (debounced + cached per `as_of`). Request: a `persist=false` option or a GET preview. |
| 16 | Freshness flag | None | `stale` is never asserted. |
| 17 | `Quality.warnings` severity | Plain strings | Shown as warnings with the backend text; structured counts produce their own facts. |
| 18 | Upload size | 10 MiB / 50 000 bars | Client pre-checks 10 MiB; everything else is the backend's rejection message. |

## Verification

`MSI_LIVE=1 npx vitest run tests/backend-integration.test.ts` (backend running) uploads `backend/fixtures/demo.csv`, loads bars,
analyses (latest and `as_of`), checks no observation is detected after the cursor, reopens the saved snapshot and compares it,
exercises the "no completed bars" rejection and a malformed upload. `tests/backend-mappers.test.ts` checks the mapping against
`backend/fixtures/*.json` without a server.

Regression coverage: `backend-client.test.ts` checks compatible TPO requests and snapshot reads without current-catalog requests; `market-replay.test.tsx` checks debounce, delayed and failed replay, with all analytical content withheld until a matching result arrives. Mapper tests check composite time/OHLC bounds, session resets, preserved knowledge and legacy/mismatched-catalog behavior. Composite bounds use visible constituent bars, never epoch defaults or price-bin centers as OHLC extrema.
