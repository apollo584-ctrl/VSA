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
The HTTP client defaults historical/as-of requests to `persist=false`; latest requests remain saved by default. Callers can explicitly override `persist` for either mode. Previews show “Preview — not saved”, retain dataset identity, and expose no snapshot link. Analysis History may record a local viewed preview without a saved-snapshot ID. The client reads `composite_profile` from the analysis response for both previews and saved results, with no separate profile recomputation request.
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
| 3 | Composite in saved snapshots | Resolved: new analyses include `composite_profile`, persisted with the same cutoff and parameters | Reopened snapshots display their preserved composite. Legacy snapshots remain without a composite. Resource-limited composites expose an explicit reason/uncertainty; no live recompute is substituted. |
| 4 | Developing profile (POC/VAH/VAL path) | Not provided | "Developing" tab disabled. |
| 5 | Value location (above/inside/below prior value) | Resolved: new analyses include top-level `value_location` (above/inside/below/unavailable) at the last visible bar, with reference session, VAL/VAH/POC and the price used | The card shows the supplied classification and levels, or the unavailable reason. Snapshots saved before this field stay "Not classified"; nothing is derived in the UI. |
| 6 | Value migration | Listed as future work (PRODUCT_SPEC) | Table of each session's own POC/VAH/VAL (raw facts, no migration label). |
| 7 | Per-observation "why identified" (which conditions held) | Resolved: new Evidence includes `conditions_met` with measured values, operators, thresholds/references and evaluated results | Instance conditions display separately from generic catalog hypotheses. Legacy snapshots use explicitly labelled, unevaluated catalog conditions when a preserved catalog exists. |
| 8 | Evidence-specific implications/alternatives/confirmation/invalidation | Concept-level only | From the preserved catalog, labelled "Generic for this concept"; explicitly unavailable when no matching preserved catalog exists. |
| 9 | Price location of an observation (e.g. above prior VAH) | Resolved: new Evidence (VSA, price-action and auction transitions) includes `value_location` frozen at `first_observable_at` | The observation panel shows the supplied location and its reference range, the reason when unavailable, and "not recorded in this snapshot" for legacy data. |
| 10 | Status history | Resolved: new Evidence includes `status_history` and typed `resolved_at`, `confirmed_at`, `invalidated_at`, `expired_at` | Authoritative history is displayed with recorded reasons. Legacy fallback uses supplied timestamps only; missing terminal times are never guessed. |
| 11 | Why-it-matters, price-action narrative, scenario "challenged by" | Not provided (`plain_english_summary` + scenarios only) | `whyItMatters` = "Not provided"; price-action/VSA/context lines are plain facts derived from supplied fields; `challengedBy` empty. |
| 12 | Auction timeline | Resolved: new analyses include `auction_state.session_resets`, explicit session-boundary events kept apart from `transitions` (first bar time, `first_observable_at`, previous state, prior-value reference status) | Recorded resets are listed in a "Session resets" panel with the backend's own times; nothing is added to the state timeline or transitions. Legacy snapshots (`session_resets` null) say none were recorded and none are inferred. Historical states still end at their session's last visible bar, and a final state without current-session transition evidence is shown only at the analysis cutoff, marked as such. |
| 13 | Profile shape confidence | Only `ambiguity` low/high (always high so far) | Ambiguity badge; no percentage. |
| 14 | Nine concepts are `knowledge_only` (e.g. shakeout, volume_divergence) | Never emitted | Knowledge Explorer badges them "knowledge only — no detector". |
| 15 | Non-persisting replay/preview | Resolved: `POST /analyze` accepts `persist=false`, returning 200, `persisted=false`, `id=null`, with no writes | Historical/replay requests use previews by default; latest requests keep the original save behavior. Unsaved results have no saved-snapshot link. |
| 16 | Freshness flag | None | `stale` is never asserted. |
| 17 | `Quality.warnings` severity | Plain strings | Shown as warnings with the backend text; structured counts produce their own facts. |
| 19 | Typing a symbol | Resolved: `POST /datasets/from-symbol` loads recent delayed bars from Yahoo Finance as a normal dataset | The top-bar search offers "Load SYMBOL from Yahoo Finance" for ticker-like text (real backend only). On success the new dataset is selected and every tab uses it; failures show the backend's message and select nothing. Each refresh with newer bars is a new immutable dataset. Not a real-time feed. |
| 20 | S&P 500 scanner | Provided: `GET /scan`, `POST /scan/run`, `POST /scan/auto` (see API_CONTRACT.md) | Scanner tab lists flagged symbols with the supplied votes; Open analysis loads the symbol via from-symbol. Real backend only. |
| 18 | Upload size | 10 MiB / 50 000 bars | Client pre-checks 10 MiB; everything else is the backend's rejection message. |

## Verification

`MSI_LIVE=1 npx vitest run tests/backend-integration.test.ts` (backend running) uploads `backend/fixtures/demo.csv`, loads bars,
analyses (latest and `as_of`), checks no observation is detected after the cursor, reopens the saved snapshot and compares it,
exercises the "no completed bars" rejection and a malformed upload. `tests/backend-mappers.test.ts` checks the mapping against
`backend/fixtures/*.json` without a server.

Regression coverage: `backend-client.test.ts` checks compatible TPO requests and snapshot reads without current-catalog requests; `market-replay.test.tsx` checks debounce, delayed and failed replay, with all analytical content withheld until a matching result arrives. Mapper tests check composite time/OHLC bounds, session resets, preserved knowledge and legacy/mismatched-catalog behavior. Composite bounds use visible constituent bars, never epoch defaults or price-bin centers as OHLC extrema.

Session-reset coverage: backend tests check usable/unusable prior value, non-neutral previous state, in-session gaps versus boundaries, replay before and at the observable time, saved/preview equivalence and untouched legacy records; frontend tests check mapping, legacy `null`, the replay guard and the panel text.

Preview/composite coverage also checks unchanged database records across repeated previews, default saves, preview storage rejection, custom-parameter/cutoff composites, restart persistence, resource-bound notices and unchanged legacy records. Frontend checks verify preview identity without snapshot links, explicit save overrides and complete saved-result equality including composites.
