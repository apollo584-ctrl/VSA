# Market Structure Intelligence — first vertical slice

## Purpose and boundaries

Describe historical market observations and plausible meanings with traceable evidence. This backend does not generate trade recommendations, infer institutional identity, or claim predictive performance. Demo data is synthetic. No external LLM or market-data subscription is needed.

The starting repository contained a frontend package manifest and installed dependencies, with no reusable application source or backend. Frontend files are owned by Claude and were not edited.

## Delivered scope

- Python 3.12+, FastAPI, Pydantic v2, Pandas/NumPy, SQLite snapshots and Pytest.
- Immutable CSV ingestion with raw-source preservation, SHA-256, adjustment and timestamp metadata, XNYS holidays/early closes/DST, data-quality warnings and explicit rejection of malformed input.
- Estimated TPO occupancy and uniform bar-volume profiles, contiguous value areas, POC, numerical shape descriptors, nodes, estimated single prints, developing/session/composite distributions and regular-session initial balance/range extensions.
- Prior-only volume/spread baselines, same-local-time relative volume, wick/displacement features and 17 VSA rule detectors. The versioned catalog covers all 26 requested VSA concepts and marks nine as `knowledge_only`.
- Rolling-boundary breakouts and same-bar failed breakouts, wick observations, delayed-confirmation pivots and higher/lower pivot relations.
- Prior-complete-session value references with breakout, acceptance, rejection and balance transitions.
- Deterministic evidence-linked hypotheses, alternatives, confirmation/invalidation conditions, uncertainty and mixed-evidence/no-pattern output.
- Versioned REST endpoints, generated OpenAPI, frontend response fixtures and a reproducible synthetic demo.

## Architecture and authority

`data.py` validates the CSV boundary. `store.py` owns atomic dataset and analysis inserts. `models.py` is the shared API contract. `profiles.py`, `features.py`, `vsa.py`, `price_action.py` and `auction.py` calculate deterministic findings. `interpretation.py` combines those findings into explicit hypotheses. `knowledge/` provides validated versioned explanatory concepts. `main.py` is the transport layer; it does not own analytical rules.

Observations have stable IDs within a dataset and parameter selection. API-created snapshot IDs are UUIDs. Saved analyses preserve the source declaration, complete parameters, engine/knowledge versions, catalog, session profiles and composite profile, so later reads do not recompute history. `POST /analyze` defaults to saving; `persist=false` calculates a preview with a null ID and no database writes. Dataset insertion stores metadata, normalized bars and original CSV in one SQLite transaction. Saved retries create separate snapshots; upload/analyze idempotency keys are not implemented. There are no update or delete endpoints. Legacy snapshots remain unchanged and may lack composites or preserved knowledge.

## Causality and data policy

Input CSV bars must be final. A bar becomes observable at its end, not its start. `as_of` filters on `available_at` before any calculation. Baselines exclude the current bar. Pivots appear only after the right-hand confirmation bars finish. VSA candidates retain their original timestamp and first-observable time; subsequent price confirmation is distinct from semantic certainty. New observations preserve evaluated detector comparisons and timestamped status history, including VSA confirmation, invalidation and expiry. Legacy snapshots remain readable without reconstructed rule results or guessed lifecycle times. Auction decisions use the previous observed session only if it is complete, and consecutive-close counts reset at gaps.

Regular hours come from `exchange_calendars` XNYS. The explicitly declared extended analysis window is 04:00–20:00 America/New_York on XNYS session dates; it is a window convention, not a guarantee about a particular broker/venue. Daily bars, partial bars, alternate exchanges and live streaming are outside this slice. Regular-session 60-minute bars are rejected because they do not tile a 390-minute day; use 1/5/15/30 minutes. Extended 60-minute bars are supported. End-labeled bars are converted to start labels by subtracting the declared interval. No automatic resampling is performed.

Bad OHLC, missing cells, nonfinite values, negative volume, duplicate/unsorted timestamps, bars outside session grids and incompatible declared split adjustments are rejected. Missing scheduled bars and absent sessions are reported, never filled. Adjacent price discontinuities at the configurable ratio threshold (default 1.8) flag possible splits/gaps. Such datasets remain inspectable but analysis/profile calculations are blocked rather than mixing price bases. This heuristic cannot identify all splits; uploader declarations are not independently verified. Historical as-of analysis recalculates quality from its visible prefix.

## Explicit remaining work

This is the requested initial working vertical slice, not completion of every Stage 2–5 feature. Nine VSA concepts remain knowledge-only: shakeout, successful test of supply, low-volume pullback, potential absorption of selling/buying, failed upward breakout (multi-bar VSA version), supply entering, high-volume rejection, and volume divergence. The price-action layer does implement a same-bar failed-breakout proxy.

Full trading-range/retest and momentum/volatility transition detectors, value migration, richer auction transitions, true trade-at-price ingestion, calibrated shape confidence, independently verified corporate actions, live provider adapters, provider-specific extended sessions and predictive/holdout studies remain future work. Excess and poor extremes are explicitly indeterminate from this input. Every shape has high ambiguity; thresholds have not been empirically calibrated.

Local developer deployment only: no authentication, rate limiting, multi-tenant isolation, schema migration tooling, remote ingestion or public hosting is included. Bind the development server to loopback. Resource bounds: 10 MiB CSV, 50,000 bars, five-year span, 2,000 price bins per profile; OHLC <= 1e9, volume <= 1e15 and bin size >= 0.000001 prevent numerical overflow and impractical grids.

## Acceptance checks for this slice

Upload the synthetic CSV, retrieve normalized bars and profiles, create and retrieve a persisted analysis, browse concepts and their relationships, and connect a local frontend using `API_CONTRACT.md`. Focused tests must establish numerical profile behavior, contextual detection, as-of invariance, delayed pivots, missing-data behavior, calendar boundaries, state transitions, contradictions and API persistence. Passing software tests makes no claim about trading accuracy.
