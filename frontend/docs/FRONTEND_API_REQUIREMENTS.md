# Frontend API requirements (proposal for backend coordination)

At the time this frontend was built, `docs/PRODUCT_SPEC.md`, `docs/API_CONTRACT.md` and `docs/KNOWLEDGE_SCHEMA.md`
did not exist (the repository was empty). This document records **exactly what the frontend consumes**, so the
backend contract can be aligned with it — or this file updated — rather than either side inventing incompatible shapes.

The single source of truth in code is [`lib/api/schemas.ts`](../lib/api/schemas.ts) (Zod). Every response is validated
at runtime; a mismatch surfaces as an "Invalid data" state, never as silently wrong analysis.

## Endpoints used

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/instruments?q=` | Instruments/datasets with `timeframes`, `sessions`, `availableDates`, `source` |
| GET | `/api/v1/instruments/{symbol}/bars?timeframe&session&to&limit` | OHLCV bars (unix seconds, UTC) + data quality |
| GET | `/api/v1/instruments/{symbol}/analysis?timeframe&session&asOf` | Full analysis snapshot **as of** `asOf` |
| GET | `/api/v1/knowledge` | Knowledge concepts (see schema) |
| POST | `/api/v1/datasets` (multipart `file`) | Upload; returns `{accepted, datasetId, issues[]}` |

Errors: `{ "error": { "code": string, "message": string } }` with a non-2xx status.

## Behavioural requirements

1. **No look-ahead.** `analysis?asOf=T` must contain only what was knowable at T: events with `detectedAt <= T`,
   statuses as of T (`statusHistory` truncated), auction states/transitions with `detectedAt <= T`, profiles built from
   bars `<= T`. The UI re-filters defensively, but the backend is authoritative.
2. **Estimated profiles.** Every `Profile` carries `estimated: boolean` (+ `estimationMethod`). The UI shows an
   "Estimated Profile" badge whenever `estimated` is true and never presents estimates as exact volume-at-price.
3. **Backend owns classification.** Profile `shape.type` (`D|P|b|B|trend|multi|undetermined`), HVN/LVN, value area,
   VSA events, auction states and the interpretation are rendered, never recomputed.
4. **Observation vs hypothesis.** `implications` (events) and `scenarios` (interpretation) are presented as hypotheses;
   `measurements`, `conditions`, and evidence items are presented as observations.
5. **Analysis timeframe.** If the engine analyses a different timeframe from the one charted, set
   `analysisTimeframe`; the UI maps event times onto the containing bar.
6. **Status values.** Analysis `status`: `ok | insufficient_data | invalid_data` (+ `statusMessage`). The chart stays
   viewable in the latter two cases.
7. **Detection status.** `provisional | confirmed | invalidated | historical`, with timestamped `statusHistory`.
8. **Data provenance.** `source.kind` is `historical | fixture | live`. The UI never claims real-time data unless the
   backend explicitly reports `live`.

## Open questions for the backend

- Pagination / windowing for `bars` (the UI currently requests the whole selected window).
- Whether `asOf` should accept bar open time (current assumption) or close time.
- Knowledge IDs: the UI links profile shapes via `shape.knowledgeSlug` and VSA events via `knowledgeSlugs[]`;
  slugs used by fixtures are listed in `fixtures/knowledge.ts`.
- Session handling for `ETH`/`ALL` (the UI disables unsupported sessions from `instrument.sessions`).
