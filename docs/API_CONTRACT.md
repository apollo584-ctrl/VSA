# Backend API contract — v1 / engine 0.1.0

Base URL: `http://127.0.0.1:8000/api/v1`. Interactive schemas: `/docs`; machine-readable schema: `/openapi.json` and `backend/fixtures/openapi.json`. OpenAPI generated from Pydantic is the authoritative field/type definition. Fields documented here are stable within v1; additions must be documented and breaking changes need a new API version.

## Endpoint reference

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/health` | — | status, engine_version, knowledge_version, live_data=false |
| GET | `/instruments` | — | `{items: [{instrument, dataset_ids}]}` for uploaded instruments only |
| POST | `/datasets/upload` | multipart file and metadata JSON string | 201 Dataset |
| GET | `/datasets/{id}` | dataset UUID | Dataset |
| GET | `/market/bars` | dataset_id; optional as_of, offset=0, limit=1000 (max 10000) | Bar array |
| GET | `/profiles` | dataset_id; optional as_of, bin_size=.25, value_area_fraction=.7, composite=false | Profile array |
| GET | `/knowledge/concepts` | optional category | Concept array |
| GET | `/knowledge/concepts/{id}` | concept ID | Concept |
| GET | `/knowledge/concepts/{id}/related` | concept ID | related Concept array |
| POST | `/analyze` | AnalyzeRequest JSON | 201 Analysis |
| GET | `/analyses/{id}` | analysis UUID | persisted Analysis |

Categories include `strength`, `weakness`, `neutral`, `profile`, `auction`, `price_action`, `data`, `limitations`. Unknown IDs return 404. Validation failures return 422 with FastAPI's `detail` (string for domain rejection, array for request schema errors). Errors create no dataset or analysis snapshot. Each response includes `X-Request-ID`. There is no live instrument discovery.

## CSV and upload metadata

UTF-8 header, exactly: `timestamp,open,high,low,close,volume`. Each row is one completed bar. Prices must be finite and positive; volume finite and nonnegative. Input order must be strictly increasing. Naive timestamps use metadata's IANA `timezone`; offset-aware timestamps are normalized to UTC. Mixing naive and aware timestamps is rejected. Ambiguous/nonexistent local DST times are rejected.

```json
{
  "instrument": "DEMO",
  "timeframe_minutes": 5,
  "exchange": "XNYS",
  "session_mode": "regular",
  "timestamp_convention": "bar_start",
  "timezone": "America/New_York",
  "price_adjustment": "unadjusted",
  "volume_adjustment": "raw",
  "source_name": "deterministic_synthetic_v1",
  "is_demo": true
}
```

`price_adjustment`, `volume_adjustment`, `instrument` and `source_name` are required. Split-adjusted prices require split-adjusted volume; unadjusted prices require raw volume. `is_demo` is uploader-declared, as is adjustment provenance. CSVs are not combined or resampled. Timeframes are 1/5/15/30 minutes for regular sessions and also 60 for extended sessions. Partial bars are rejected. Extended-session details and limitations are in `PRODUCT_SPEC.md`.

The Dataset response contains `id`, `content_sha256` (original bytes), `source`, `created_at`, `row_count`, `first_timestamp`, `last_available_at` and `quality`. Quality reports warnings, missing bar count, absent session dates, incomplete session dates and split suspicion. It counts the full known schedule for each session spanned, including leading/trailing gaps; an in-progress session therefore counts as incomplete.

## Analysis request and causality

```json
{
  "dataset_id": "UUID returned by upload",
  "as_of": "2025-03-10T20:00:00Z",
  "parameters": {"bin_size": 0.25, "value_area_fraction": 0.7}
}
```

`as_of` and `parameters` are optional. An offset is mandatory when `as_of` is supplied. Only bars whose `available_at <= as_of` are used. Without it, the latest supplied completed bar is used; this does not imply live/current data. The result's `analysis_timestamp` is the last visible bar's completion. `created_at` is the actual calculation time. Repeated POSTs create separate immutable snapshots, with no trading side effects. Canonical behavior is reproducible after excluding snapshot IDs and creation times.

All parameter defaults and bounds are in `Parameters` in OpenAPI. Major controls include lookback/minimum history, relative-volume/spread thresholds, wick/close fractions, confirmation horizon, pivot confirmation bars, acceptance close count, shape skew/node/valley criteria and split-gap ratio. Shape TPO occupancy uses 30-minute periods by default (60-minute bar input requires `parameters.tpo_minutes=60`). Initial balance must be an exact multiple of the bar interval. Bin size must be at least 0.000001; ingestion caps prices at 1e9 and volume at 1e15 for numerical safety.

## Chart and evidence contract

Bar fields: `timestamp` (normalized UTC start), `available_at` (completion), `session` (New York date), `open`, `high`, `low`, `close`, `volume`. Never use a bar's full OHLCV as available at its start.

Profiles contain `id`, `session`, `scope`, `as_of`, `bin_size`, `price_bin_lower`, `price_bin_center`, `tpo`, `volume`, `hvns`, `lvns`, `single_print_bins`, `initial_balance`, `range_extension`, `extremes` and `limitations`. Distribution counts align one-to-one with bin arrays. `poc` is a bin center; `val` and `vah` are outer edges of the contiguous value area. Ties choose the lower bin. Contiguous expansion starts at POC and adds the heavier neighboring bin; equal neighboring weights choose lower. `achieved_value_fraction` can exceed the requested fraction. Zero total volume gives null volume POC/VA levels and unclassified shape; TPO can still exist.

TPO method is `estimated_tpo_range_occupancy`: unique touched bins per session/TPO period. Volume method is `estimated_uniform_volume_per_touched_bin`: each bar's volume divided equally among all bins its inclusive OHLC range touches. Both have `estimated=true`. These are not exact trade-at-price or exact intrabar occupancy. Centers may fall slightly outside actual traded extrema because they represent intervals. Initial balance is available only for regular session profiles, with `complete=false` until its full window is present; range extensions remain null until complete. Excess/poor extremes remain indeterminate. Composite profiles have no single-session initial balance.

VSA, price-action and auction observations share Evidence: `id`, `kind` (`observed` or `classified`), `concept_id`, original bar `timestamp`, `first_observable_at`, optional `confirmed_at`, `status`, `direction`, `description`, chart `coordinates`, numerical `measurements`, and `supporting_evidence` IDs. Stable IDs are scoped to a dataset and parameter set; do not merge IDs across datasets/configurations. `direction` is a contextual strength/weakness/neutral label, not a trade instruction.

Neutral VSA measurements have `observed` status. Directional candidates start `provisional`; a later contiguous same-session close beyond the candidate's high/low confirms price follow-through, while a close through the opposite extreme invalidates it. The first resolving close wins. `resolved_at` in measurements covers both outcomes. Unresolved candidates expire after the configured contiguous horizon; a gap/session boundary leaves an unresolved candidate provisional. Pivots are emitted only at their right-bar confirmation time and cannot appear earlier. VSA baselines use prior completed bars across sessions; time-of-day volume compares prior sessions' same local slot.

## Explanation and frontend wiring

Analysis fields: `id`, `engine_version`, `knowledge_version`, `dataset_id`, `instrument`, `timeframe`, `analysis_timestamp`, `created_at`, `provenance`, `parameters`, `data_quality`, `market_context`, `profile_analysis`, `vsa_observations`, `price_action_observations`, `auction_state`, `supporting_evidence`, `contradicting_evidence`, `interpretations`, `alternative_scenarios`, `confirmation_conditions`, `invalidation_conditions`, `uncertainties`, `plain_english_summary`.

Each Scenario has `kind=inferred`, `id`, `description`, `evidence_ids`, `confirmation_conditions`, `invalidation_conditions`. IDs resolve against profile IDs and the VSA/price-action/auction Evidence lists in that response. `uncertainties` are explicit limits; neither shape ambiguity nor detector confirmation is a predictive probability. The catalog's `detector_status` is `implemented` or `knowledge_only`; only implemented rules can emit observations.

Claude should use `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1` and follow this sequence:

1. Upload `file` and `metadata` using FormData. Let the browser set the multipart Content-Type boundary.
2. Retain the returned dataset ID and show quality warnings and source/demo badges.
3. Fetch bars with pagination; convert ISO timestamps to epoch seconds for chart libraries.
4. POST analysis with the dataset ID and optional historical `as_of`; use its normalized chart levels and observation timestamps.
5. Display observed measurements, rule classifications, hypotheses and uncertainty separately. Link explanation evidence IDs to chart annotations and the knowledge concept endpoint. Show provisional/confirmed status and estimation badges.
6. Retain the analysis ID to reopen the immutable snapshot. Recompute explicitly when parameters/as-of change.

```javascript
const base = process.env.NEXT_PUBLIC_API_BASE_URL;
const body = new FormData();
body.append('file', file);
body.append('metadata', JSON.stringify(metadata));
const uploaded = await fetch(`${base}/datasets/upload`, {method: 'POST', body});
if (!uploaded.ok) throw new Error(JSON.stringify(await uploaded.json()));
const dataset = await uploaded.json();
const response = await fetch(`${base}/analyze`, {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({dataset_id: dataset.id})
});
if (!response.ok) throw new Error(JSON.stringify(await response.json()));
const analysis = await response.json();
```

CORS defaults to `http://localhost:3000` and `http://127.0.0.1:3000`; override with comma-separated `MSI_CORS_ORIGINS`. No frontend files were edited. Synthetic mock responses and metadata are in `backend/fixtures/`; their fixed UUIDs are mock identifiers and cannot be used against a fresh database. Actual upload responses supply real IDs.
