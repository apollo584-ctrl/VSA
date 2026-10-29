# Backend API contract — v1 / engine 0.1.0

Base URL: `http://127.0.0.1:8000/api/v1`. Interactive schemas: `/docs`; machine-readable schema: `/openapi.json` and `backend/fixtures/openapi.json`. OpenAPI generated from Pydantic is the authoritative field/type definition. Fields documented here are stable within v1; additions must be documented and breaking changes need a new API version.

## Endpoint reference

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/health` | — | status, engine_version, knowledge_version, live_data=false |
| GET | `/instruments` | — | `{items: [{instrument, dataset_ids}]}` for stored datasets (uploaded or loaded by symbol) |
| POST | `/datasets/upload` | multipart file and metadata JSON string | 201 Dataset |
| POST | `/datasets/from-symbol` | `{symbol, timeframe_minutes=30 (5, 15 or 30), period="1mo" ("5d", "1mo" or "60d")}` | 201 Dataset; 200 existing Dataset when identical data is already stored |
| POST | `/datasets/from-contract` | `{contract, timeframe_minutes=30 (5, 15 or 30), period="60d" ("5d", "1mo" or "60d")}`; `contract` is trimmed, upper-cased and must be a listed CBOT grain contract such as `ZCZ26`, else 422 | 201 Dataset; 200 existing Dataset when identical data is already stored; 422 Not Found, no completed bars left or ingest rejection; 502 provider unreachable or unreadable. See "Loading a contract" below |
| GET | `/daily-bars` | `symbol` (trimmed, upper-cased, `^[A-Z][A-Z0-9.\-]{0,15}$`, else 422) | `{symbol, bars: [{session: "YYYY-MM-DD", open, high, low, close, volume}]}`: last 500 completed daily bars (via the outcome-study daily fetch), cached in memory for 1 hour per symbol; 422 unknown symbol, 502 provider unreachable or unreadable; same auth as every other endpoint |
| GET | `/setup-a` | `symbols` (1-8 comma-separated, else 422) | Setup A checker, see "Today's Plan" below |
| GET / POST | `/journal` | `date=YYYY-MM-DD` optional / JournalEntryIn JSON | newest-first entries / 201 entry |
| PUT | `/journal/{id}` | JournalEntryIn JSON (full replace) | entry; 404 if missing |
| GET | `/journal/export.csv`, `/journal/day-summary?date=` | — | CSV of every entry; `{date, trades, losses, realized_pnl}` |
| GET | `/datasets/{id}` | dataset UUID | Dataset |
| GET | `/market/bars` | dataset_id; optional as_of, offset=0, limit=1000 (max 10000) | Bar array |
| GET | `/profiles` | dataset_id; optional as_of, bin_size (equity default .25; grain default = contract tick), value_area_fraction=.7, value_area_method=two_row (or one_bin), composite=false | Profile array |
| GET | `/knowledge/concepts` | optional category | Concept array |
| GET | `/knowledge/concepts/{id}` | concept ID | Concept |
| GET | `/knowledge/concepts/{id}/related` | concept ID | related Concept array |
| POST | `/analyze` | AnalyzeRequest JSON; persist defaults to true | 201 saved Analysis; 200 preview |
| GET | `/analyses/{id}` | analysis UUID | persisted Analysis |

Categories include `strength`, `weakness`, `neutral`, `profile`, `auction`, `price_action`, `data`, `limitations`. Unknown IDs return 404. Validation failures return 422 with FastAPI's `detail` (string for domain rejection, array for request schema errors). Errors create no dataset or analysis snapshot. Each response includes `X-Request-ID`. There is no live instrument discovery.


### CBOT grain gate (profiles and analyze)
- `/profiles` for a grain dataset uses the stored `data_grade`/`grade_basis`, not a recompute. Daily (1440) bars: 422 `{"reason": "Daily bars cannot support an intraday profile", "data_grade"}`. Intraday (5/15/30) with stored grade B: allowed. Stored grade C or none: 422 `{reason, data_grade}` naming placeholder bars, off-grid prices or no usable bars. Equity datasets are unchanged.
- `POST /analyze` on any intraday grain dataset returns 422 `{"reason": "Analysis is not supported yet for intraday grain data", "data_grade"}`. Daily grain is still refused by the gate.
- `bin_size` is optional. Equity default 0.25. Grain default is the contract root tick; a given grain `bin_size` must be a whole multiple of the tick, else 422 `bin_size must be a whole multiple of the contract tick (<tick>)`.
- Grain TPO periods are fixed at 30 minutes whatever the bar size. Equities keep max(30, timeframe).
- Initial balance is "not computed" for grain profiles.

## Authentication

Clients on 127.0.0.1 / ::1 that address the server as `localhost`, `127.0.0.1` or `[::1]` skip login (a loopback client using any other Host name, e.g. a rebound DNS name, is treated as remote). Remote requests that send an `Origin` must name the same host they reached (dashboard and API on one PC), else 403; remote writes also need `X-MSI-Request: 1`, else 403. Login attempts are counted before the PIN is checked, so parallel guesses cannot bypass the limits. Running `python -m scripts.set_pin` logs every device out. Every other `/api/v1` request needs the `msi_session` cookie (HttpOnly, SameSite=Lax, Path=/api/v1, 30 days) obtained from `POST /api/v1/auth/login`, else `401 {"detail":"Login required"}`; with no PIN file set on the host: `401 "No PIN is set on the host PC"`. Exempt: `GET /health`, `GET /auth/status`, `POST /auth/login`, `POST /auth/logout`. `/docs`, `/redoc`, `/openapi.json` are closed to non-local clients.

- `POST /auth/login` `{"pin":"123456"}` (string of 6-12 digits, else 422): 200 sets the cookie; 401 `Wrong PIN`; 429 with `Retry-After` after 5 failures per IP in 15 min (60 s lock, doubling to 15 min) or 20 failures across all non-local clients in 60 min (30 min lock).
- `POST /auth/logout`: deletes the session and clears the cookie. `GET /auth/status` -> `{local, pin_set, authenticated}`.
- Sessions are bound to the current PIN: changing the PIN invalidates every session, including logins in flight. CORS exposes `Retry-After`.
- `POST /app/quit` (header `X-MSI-Request: 1`): runs `MSI_STOP_SCRIPT` (stop.bat) detached. Host PC only (loopback client and Host); 403 otherwise, even with a session; 501 when not started by start.bat.
- Every non-GET/HEAD/OPTIONS request from a non-local client must send `X-MSI-Request: 1`, else 403. CORS allows credentials for the `MSI_CORS_ORIGINS` list plus private-network hosts on port 3000.

## Loading a symbol

Provider responses are validated before CSV conversion: the returned symbol must match the request (case-insensitive; no implicit aliases), and timestamps and all five OHLCV arrays must have equal lengths. Malformed response structures, invalid timestamps and identity/array mismatches return 502 without storing a dataset. Explicit provider `Not Found` errors and valid empty series retain their 422 rejection behavior.

`POST /datasets/from-symbol` fetches recent completed bars for a ticker from Yahoo Finance's unofficial chart endpoint, converts them to the canonical CSV and runs them through the same validation and storage as an upload; the result is an ordinary immutable Dataset (`source_name` `yahoo_finance_chart_{period}`, `is_demo=false`, declared `split_adjusted`). `symbol` is trimmed and upper-cased and must match the instrument pattern. Only regular-session bars of an XNYS session are kept: bars still forming, empty bars and bars outside the session window (such as Yahoo's trailing 16:00 print) are dropped, never repaired. The data are delayed, the endpoint is undocumented and may be rate-limited or change, and use should respect the provider's terms; this is for testing and personal analysis. It is not a real-time feed (`/health` keeps `live_data=false`). Unknown symbols and symbols with no completed regular-session bars return 422 with a `detail` message; an unreachable or unreadable provider returns 502. Failures store nothing. Repeating a load that yields byte-identical data and provenance returns the existing dataset (200) instead of storing a duplicate; newer bars create a new dataset, since datasets are immutable.

## Loading a contract

`POST /datasets/from-contract` fetches intraday bars for one CBOT grain contract from the unofficial Yahoo chart endpoint (`<contract>.CBT`, bar-start timestamps in Chicago time) and stores them as a grain dataset (`market` cbot_grains, `Source.contract` set), mirroring `/datasets/from-symbol`. Returned symbol, instrument type FUTURE and exchange CBT must match, else 502. Drop rules (dropped, never repaired): rows with any null value; bars of a trade date whose session is not complete yet (this includes the forming bar and the still-open trade date); and a partial first trade date (no 19:00 CT evening slot in the response). If nothing is left, 422. Everything else passes through to ingest, which fails closed (422). The stored dataset gets its data grade from ingest; `/profiles` then follows the CBOT grain gate above.

## Today's Plan: Setup A checker and trade journal

A paper-trading study aid implementing `VSA Trading Plan.md` section 2. It places no orders and gives no advice.

`GET /setup-a?symbols=AAPL,MSFT` -> `{as_of, symbols: [{symbol, stage, acceptance_closes, retest_bars_left, prior_vah, prior_val, prior_poc, last_bar_time, last_close, retest, entry_reference, stop, target, contradiction, no_trade_reasons, explanation}]}`. Each symbol loads 5-minute regular-session bars (`period=5d`, same unofficial Yahoo provider; completed bars only). `stage` is one of `no_data` (fetch or parse failed; never a 500 for the whole call), `not_eligible` (early-close or non-session day, split warning, missing bars today, or no usable adjacent complete prior session), `waiting`, `counting` (1-2 closes), `retest_watch`, `triggered`, `cancelled`, `expired`. Rules: prior session VAH/VAL/POC use default engine parameters; three consecutive completed closes strictly above VAH count only for bars that start at or after 10:00 and finish by 15:00 New York, and a close at or below VAH resets the count; then the first of the next 5 bars with low <= VAH, low > VAL and close > VAH is the retest (`retest = {time, open, high, low, close}`), a close at or below VAH first cancels, and none in 5 expires. The first attempt of a session is final. `stop` = retest low - 0.01; `entry_reference` = the next bar's open (null until that bar completes); `target` = entry + 2 x (entry - stop), only with an entry. `contradiction` is true when the engine's `contradicting_evidence` at the retest bar (same path as `/analyze`, `as_of` the retest close, never later bars) is non-empty. `no_trade_reasons` lists plain-English skips: entry at or below stop, entry more than 0.25 x the stop distance above the retest close, outside the entry window, data-quality warnings, contradiction. Results at a bar never change when later bars arrive (except `entry_reference` and `target`, which appear once the next bar exists). `explanation` is a plain sentence for the stage.

Journal (SQLite table `journal_entries`, created additively; no delete endpoint; same auth as every endpoint, and CORS now allows `PUT`). Body fields: `trade_date` (YYYY-MM-DD), `symbol`, `kind` (`taken`|`skipped`), `setup_version` (default `A-1.0`), `prior_vah, prior_val, prior_poc, entry, stop, target, shares, est_costs_per_share, planned_loss, exit_price, exit_time, exit_reason` (`stop|target|time|other|null`), `fees, net_pnl, skip_reason, notes`, `rule_breach` (bool, default false); optional numbers are nullable. Responses add `id, created_at, updated_at` and `r_multiple` = `net_pnl / planned_loss`, computed by the server (null unless both exist and `planned_loss > 0`; clients cannot set it). `PUT` replaces all editable fields and refreshes `updated_at`. `GET /journal` is newest first. `GET /journal/day-summary?date=` counts only `taken` entries: `trades`, `losses` (net_pnl < 0) and `realized_pnl` (sum of net_pnl). `GET /journal/export.csv` returns every entry (text cells starting with `= + - @` get a leading apostrophe).

## S&P 500 scanner

`GET /scan` returns `{status, results}`; `POST /scan/run` (202, optional `{symbols}` subset) starts a background scan and is a no-op while one is running; `POST /scan/auto` `{minutes: 0|30|60|1440}` repeats scans while the backend process is up (in memory; not restored after restart). The universe is `backend/app/universe/sp500.json` (503 constituents from Wikipedia, 2026-10-15; share classes use Yahoo's hyphen form, e.g. `BRK-B`), refreshed manually. Each symbol loads recent 30m bars through the same Yahoo provider as `/datasets/from-symbol` (unofficial, delayed, rate-limited; four parallel workers), is analysed with `persist=false`, and its result is stored in `scan_results` (latest per symbol). No datasets or snapshots are created. A symbol that fails is recorded with `status=error` and does not stop the scan.

A result is flagged `strength` or `weakness` when at least three of four readings agree, none opposes, and the engine's own `contradicting_evidence` is empty (an engine-reported contradiction suppresses the flag). The readings share closes and prior-value levels, so the count is a heuristic, not independent corroboration: value location (above/below prior value), auction state (acceptance or rejection pointing the same way), active VSA signals in the current session (provisional or confirmed, majority direction) and current-session price-action direction (swing structure excluded). `agreeing` is the count, `votes` lists each reading, and results sort flagged first, then by agreement, with errors last. The scan describes aligned evidence; it is not a prediction or advice.

## Outcome study and intraday history

`POST /outcomes/run` starts a background study over the scan universe (daily bars, Yahoo, 10y) and returns the job status: 202 when started, 200 if one is already running. `GET /outcomes` returns `{status, study}`; `study` is the latest saved `outcomes.run_study` result (`generated_at, symbols_used, date_range, cutoff_date, horizons, min_cases, stats, holds, method_notes`, plus optional `breakdowns` and `concepts`) or `null`. Stats rows may carry optional `t_stat` and `win_loss_ratio` (null when not computable). `breakdowns` is a list of `{concept, horizon, dimension: "trend"|"volume_bucket", value, n_cases, hit_rate, edge}` (all periods combined, at least 10 cases). `concepts` maps each daily price-pattern id (inside/outside day, gaps, 20-day and 52-week highs/lows, NR7, three-day streaks, RSI(2) extremes, 200-day crosses, 50-day pullback) to `{direction, group: "price"|"momentum", label, description}`; ids not listed there are the original VSA concepts. Studies saved before these fields existed stay valid. Symbols that fail are counted in `errors` and skipped.

## Alerts and track record

Descriptive history from the latest study, not a forecast. `POST /alerts/run` starts a background job (daily bars, same universe as the study) that, for the newest completed session, saves one immutable alert per symbol/concept signal whose concept held up in the latest study, then scores every open alert at 1/5/20 days; 202 when started, 200 if running, and it fails with an error in the status if no study exists. `GET /alerts/status` returns the job status. `GET /alerts?date=YYYY-MM-DD` returns `{session, alerts, last_run}` (default: latest alerted session; `last_run = {at, session, added, scored}` or `null`). `GET /track-record` returns `{rows, round_trip_cost, min_cases}`; each row is `{concept, direction, horizon, n, hit_rate, mean_return, mean_return_net, baseline_hit_rate, verdict}` after de-duplicating overlapping alerts, with the baseline being all-day returns on the same session dates. With `MSI_AUTO_COLLECT=1` a timer checks every 30 minutes and runs the job once per weekday session after 16:30 New York time.

`POST /intraday/collect` starts a background collector that saves each universe symbol's 30m bars (`period=60d`) into `intraday_bars`; rows are insert-only, so a repeat run adds only new bars. Same 202/200 behavior. `GET /intraday` returns `{status, summary}` with `summary = {symbols, bars, first_ts, last_ts, rebased_symbols, last_collected_at}` (counts use each symbol's latest price basis only; `rebased_symbols` is how many symbols started a new basis after a split/adjustment, detected when refetched closes differ by more than 0.1%; old rows are kept, never overwritten; `last_collected_at` is set only when at least one symbol succeeded). With env `MSI_AUTO_COLLECT=1` the collector starts at backend startup when `last_collected_at` is missing or older than 3 days (off by default).

Job `status` fields: `running, started_at, finished_at, total, done, errors, bars_added, error` (`bars_added` is used by the collector only; `error` is a string when saving/finalizing the run failed, otherwise null).

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

### CBOT grain daily uploads
`market: "cbot_grains"` with `timeframe_minutes: 1440` and a `contract` (for example `ZCZ26`) is ingested as daily bars. Each timestamp cell must be an ISO date `YYYY-MM-DD`, strictly increasing, on a grain open day (weekday and not on the XNYS-stand-in holiday list; unverified), and on or before the contract's last trade date (the open day before the 15th of the delivery month); later bars are rejected as "bar after contract expiry (possible contract roll)". Volume 0 is allowed. Intraday grain data is rejected ("Intraday grain data is not supported yet"). Each bar's `available_at` is the end of that trade date's last session (13:20 America/Chicago), so nothing is visible before the session closes. The Dataset carries `data_grade` (daily is "C"), `grade_basis` and `limitations` (Yahoo unverified, specs unverified, placeholder and off-grid counts). `GET /profiles` and `POST /analyze` on such a dataset return 422 with `detail: {reason, data_grade}`. Dataset read, list and bar endpoints work normally. Equity datasets keep `data_grade: null`.

Optional futures fields (additive; equity sources are unchanged): `Source.market` (`equity_xnys` default, or `cbot_grains`) and `Source.contract` (e.g. `ZCZ26`, pattern `^[A-Z]{1,3}[FGHJKMNQUVXZ][0-9]{2}$`). `exchange` is `XNYS` or `CBOT`; `timeframe_minutes` also allows `1440` (daily, futures only). `equity_xnys` requires exchange XNYS, no contract and an intraday timeframe; `cbot_grains` requires exchange CBOT, timezone `America/Chicago`, a contract, and `instrument` equal to the contract. Dataset, Profile and Analysis carry optional `data_grade` (`A`, `B`, `C` or null) and `grade_basis`; Dataset and Analysis also carry `limitations` (list, empty by default). For equities these stay null/empty. Futures data from Yahoo is unofficial and unverified against CME; grade `A` is never assigned. Stored records without these fields still load.

The Dataset response contains `id`, `content_sha256` (original bytes), `source`, `created_at`, `row_count`, `first_timestamp`, `last_available_at` and `quality`. Quality reports warnings, missing bar count, absent session dates, incomplete session dates and split suspicion. It counts the full known schedule for each session spanned, including leading/trailing gaps; an in-progress session therefore counts as incomplete.

## Analysis request and causality

```json
{
  "dataset_id": "UUID returned by upload",
  "as_of": "2025-03-10T20:00:00Z",
  "parameters": {"bin_size": 0.25, "value_area_fraction": 0.7}
}
```

`as_of`, `parameters` and `persist` are optional. An offset is mandatory when `as_of` is supplied. Only bars whose `available_at <= as_of` are used. Without it, the latest supplied completed bar is used; this does not imply live/current data. The result's `analysis_timestamp` is the last visible bar's completion. `created_at` is the actual calculation time. With `persist=true` (the default), each successful POST creates a separate immutable snapshot and returns HTTP 201, `persisted=true` and a non-null UUID `id`. Canonical behavior is reproducible after excluding snapshot IDs and creation times.

For replay, send `"persist": false` with the same request. Successful previews return HTTP 200, `persisted=false`, `id=null` and the same analytical content for the same input/parameters/cutoff. They insert no dataset or analysis records, cannot be fetched by analysis ID, and must not be displayed as saved snapshots. Failed requests create no snapshot in either mode. Existing callers that omit `persist` retain the original save behavior. Example requests/responses for both modes are in `backend/fixtures/` (`preview_request.json`, `preview_response.json`).

All parameter defaults and bounds are in `Parameters` in OpenAPI. Major controls include lookback/minimum history, relative-volume/spread thresholds, wick/close fractions, confirmation horizon, pivot confirmation bars, acceptance close count, shape skew/node/valley criteria and split-gap ratio. Shape TPO occupancy uses 30-minute periods by default (60-minute bar input requires `parameters.tpo_minutes=60`). Initial balance must be an exact multiple of the bar interval. Bin size must be at least 0.000001; ingestion caps prices at 1e9 and volume at 1e15 for numerical safety.

## Chart and evidence contract

Bar fields: `timestamp` (normalized UTC start), `available_at` (completion), `session` (New York date), `open`, `high`, `low`, `close`, `volume`. Never use a bar's full OHLCV as available at its start.

Profiles contain `id`, `session`, `scope`, `as_of`, `bin_size`, `price_bin_lower`, `price_bin_center`, `tpo`, `volume`, `hvns`, `lvns`, `single_print_bins`, `initial_balance`, `range_extension`, `extremes` and `limitations`. Distribution counts align one-to-one with bin arrays. `poc` is a bin center; `val` and `vah` are outer edges of the contiguous value area. Ties choose the lower bin. Contiguous expansion starts at POC and adds the heavier neighboring bin; equal neighboring weights choose lower. `achieved_value_fraction` can exceed the requested fraction. Zero total volume gives null volume POC/VA levels and unclassified shape; TPO can still exist.

TPO method is `estimated_tpo_range_occupancy`: unique touched bins per session/TPO period. Volume method is `estimated_uniform_volume_per_touched_bin`: each bar's volume divided equally among all bins its inclusive OHLC range touches. Both have `estimated=true`. These are not exact trade-at-price or exact intrabar occupancy. Centers may fall slightly outside actual traded extrema because they represent intervals. Initial balance is available only for regular session profiles, with `complete=false` until its full window is present; range extensions remain null until complete. Excess/poor extremes remain indeterminate. Composite profiles have no single-session initial balance.

VSA, price-action and auction observations share Evidence: `id`, `kind` (`observed` or `classified`), `concept_id`, original bar `timestamp`, `first_observable_at`, optional `confirmed_at`, `status`, `direction`, `description`, chart `coordinates`, numerical `measurements`, and `supporting_evidence` IDs. Stable IDs are scoped to a dataset and parameter set; do not merge IDs across datasets/configurations. `direction` is a contextual strength/weakness/neutral label, not a trade instruction.

New Evidence includes `conditions_met`: evaluated detector comparisons with `id`, `label`, `metric`, `actual`, `operator`, `expected`, optional `reference`, and nullable boolean `met`. The same comparisons drive detection; these are instance measurements, separate from generic catalog explanations. Missing inputs are unevaluated (`met=null`).

Neutral VSA measurements have `observed` status. Directional candidates start `provisional`; a later contiguous same-session close beyond the candidate's high/low confirms price follow-through, while a close through the opposite extreme invalidates it. The first resolving close wins. Typed `resolved_at` and the corresponding `confirmed_at`, `invalidated_at`, or `expired_at` record that outcome; `measurements.resolved_at` is retained for compatibility. `status_history` records each observable status with `at` and `reason`. Unresolved candidates expire at the configured contiguous horizon's completion; a gap/session boundary leaves an unresolved candidate provisional. Pivots are emitted confirmed only at their right-bar confirmation time and cannot appear earlier. VSA baselines use prior completed bars across sessions; time-of-day volume compares prior sessions' same local slot. Legacy snapshots default to empty conditions/history and nullable resolution fields, without rewriting or inventing historical facts.

## Explanation and frontend wiring

Analysis fields: `id`, `engine_version`, `knowledge_version`, `dataset_id`, `instrument`, `timeframe`, `analysis_timestamp`, `created_at`, `provenance`, `parameters`, `data_quality`, `market_context`, `profile_analysis`, `vsa_observations`, `price_action_observations`, `auction_state`, `supporting_evidence`, `contradicting_evidence`, `interpretations`, `alternative_scenarios`, `confirmation_conditions`, `invalidation_conditions`, `uncertainties`, `plain_english_summary`.

Additional fields: `persisted`, `composite_profile` and `composite_unavailable_reason`. The separate composite field preserves `profile_analysis` as session profiles. New saved and preview results calculate the composite from exactly their visible bars and full parameters, including TPO interval and value-area percentage. Saved results preserve that object alongside the session profiles; GET `/analyses/{id}` reads it without recomputation. The frontend should use this object rather than a separate GET `/profiles` call. Legacy snapshots have `persisted=true` and a null composite; they are not rewritten or backfilled. If the full composite range exceeds the 2,000-bin limit while individual sessions remain valid, the analysis succeeds with a null composite, an explicit `composite_unavailable_reason` and an uncertainty notice; increase `bin_size` to obtain it. Other validation/calculation errors retain their normal rejection behavior.

### Developing profile and value migration

`Analysis.developing_profile` is `{session, method="volume", points[]}` for the latest visible session; each point (`timestamp`, `available_at`, `poc`, `vah`, `val`) is the volume profile computed from only the bars closed by that point's `available_at`, so a replay at an earlier `as_of` returns a prefix of the full path. Bars with no value area (zero volume) produce no point; the field is null when none does.

`Analysis.value_migration` has one step per session after the first: `session`, `previous_session`, `relationship`, `unavailable_reason`, `final`, the session's `poc`/`vah`/`val` and the `prior_*` levels used. Relationship rules: `higher_value` when VAL > prior VAH; `lower_value` when VAH < prior VAL; otherwise the areas overlap (touching a boundary counts as overlap) and the POC direction decides: `overlapping_higher`, `overlapping_lower` or `overlapping_unchanged`. The reference is the previous scheduled session and must be complete; otherwise `relationship` is null with `prior_session_not_adjacent`, `prior_session_incomplete` or `prior_value_area_unavailable`. `final=false` marks the session still developing, whose relationship can change as bars arrive. Both fields are persisted with new snapshots, equal in previews, and null for legacy snapshots (not reconstructed). They are descriptive facts, not predictions.

### Price location (`value_location`)

`Analysis.value_location` (current context at the last visible bar) and `Evidence.value_location` (context when that observation first became observable) report where a close sat relative to the previous complete session's volume value area. Fields: `state` (`above_value`, `inside_value`, `below_value` or `unavailable`), `price` (the price used) with `price_basis=bar_close`, `as_of` (the `available_at` of the bar whose close is used), `reference_session`, `val`, `vah`, `poc` (all null when unavailable) and nullable `unavailable_reason` (`no_prior_session`, `prior_session_not_adjacent`, `prior_session_incomplete` or `prior_value_area_unavailable`). Equality is explicit: `VAL <= price <= VAH` is `inside_value`; `price > VAH` is `above_value`; `price < VAL` is `below_value`. The reference is the same one the auction classifier uses (previous scheduled session, complete, with a volume value area); a missing, incomplete or unusable reference yields `unavailable` with the reason, never a guess. The price for an observation is the close of the bar that completed at its `first_observable_at`, and the reference is that bar's session reference, so a delayed pivot is located when it became observable, not at the pivot bar, and an observation never sees later sessions' levels. Replays at an earlier `as_of` therefore return identical locations for the observations they contain. Saved snapshots and `persist=false` previews carry the same values. Legacy snapshots return `value_location=null` (top level and per observation), meaning "not recorded"; they are not rewritten or reconstructed. Detector rules are unchanged.

`auction_state.session_resets` lists each point where the auction state restarts at a new session. A reset is not Evidence and not a market-driven transition: it is never in `transitions` or `evidence_ids`, and no state change is derived from it. Each item has `id` (`auction_reset:{session}`), `kind=session_reset`, `reason=new_session`, `session` (entered), `previous_session`, `timestamp` (the new session's first bar), `first_observable_at` (that bar's `available_at`, the earliest the reset is knowable), `previous_state` (the classification in force at the last visible bar of the prior session, possibly non-neutral), `state` (always `indeterminate`), `reference_session`, `reference_usable`, nullable `reference_unavailable_reason` (`prior_session_not_adjacent`, `prior_session_incomplete` or `prior_value_area_unavailable`) and `description`. A reset is emitted only when a prior session exists in the visible bars; the first session has none. A gap of missing bars inside a session is not a reset. Whether the prior session supplies a usable value reference follows the existing rule (previous scheduled session, complete, with a volume value area) and is reported, not changed. Resets use only bars visible at `as_of`, so a reset appears only once its first bar is complete. Saved snapshots and `persist=false` previews carry identical lists. Legacy snapshots saved before this field return `session_resets=null` ("not recorded"); they are neither rewritten nor given reconstructed resets. A new analysis with no session boundary returns an empty list.

Each Scenario has `kind=inferred`, `id`, `description`, `evidence_ids`, `confirmation_conditions`, `invalidation_conditions`. IDs resolve against profile IDs and the VSA/price-action/auction Evidence lists in that response. `uncertainties` are explicit limits; neither shape ambiguity nor detector confirmation is a predictive probability. The catalog's `detector_status` is `implemented` or `knowledge_only`; only implemented rules can emit observations.

Additive v1 field: new analyses include `knowledge_snapshot: {version, concepts}` containing the validated catalog used at creation. Its version matches `knowledge_version`. This object is persisted with the analysis so generic concept definitions, implications and conditions can be displayed without consulting a later catalog. Existing stored analyses predate this field and return null; clients must treat missing/null or version-mismatched embedded catalogs as unavailable and display the stored observations/scenarios without substituting current knowledge. No database migration or rewrite of old snapshots is performed.

Claude should use `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1` and follow this sequence:

1. Upload `file` and `metadata` using FormData. Let the browser set the multipart Content-Type boundary.
2. Retain the returned dataset ID and show quality warnings and source/demo badges.
3. Fetch bars with pagination; convert ISO timestamps to epoch seconds for chart libraries.
4. POST analysis with the dataset ID and optional historical `as_of`; use its normalized chart levels and observation timestamps.
5. Display observed measurements, rule classifications, hypotheses and uncertainty separately. Link explanation evidence IDs to chart annotations and the knowledge concept endpoint. Show provisional/confirmed status and estimation badges.
6. Retain a non-null analysis ID only when `persisted=true`, to reopen the immutable snapshot. Use `persist=false` when replaying or previewing changes; save explicitly with `persist=true` when a historical result should become a snapshot.

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

## Value area method (step 3.2a)

`Parameters.value_area_method` and the `/profiles` query parameter `value_area_method` accept `two_row` (default) or `one_bin`. Profile output shape is unchanged.

- Default change: value areas (VAL, VAH, achieved_value_fraction, developing value path) now use `two_row`. Pass `one_bin` to get the previous results.
- `two_row`: start at the POC bin (ties: lowest price). Each step sums the next two bins above and the next two bins below the area (one bin if only one remains on a side, 0 if none) and adds the larger pair; on a tie the lower side is added. Repeat until the enclosed weight is at least `value_area_fraction` x total, or no bins remain.
- `one_bin`: grow one bin at a time toward the larger neighbour (ties: lower).

## ATR, volatility regime and slope trend (step 3.2b)

New `Parameters` (all validated): `atr_period` int 14 (3..100); `regime_window` int 100 (20..500); `regime_low` float 0.75 (0 < x < 1); `regime_high` float 1.25 (1 < x <= 10); `trend_method` `slope` (default) or `close_difference`; `trend_atr_threshold` float 1.0 (0 < x <= 10). `regime_low` must be below 1 and `regime_high` above 1.

All values are prior-only: bar i uses only bars before i.

- True range of bar j = max(high - low, |high - previous close|, |low - previous close|); the first bar in the data uses high - low.
- `atr` = simple mean of the true ranges of the `atr_period` bars before bar i; null with fewer prior bars.
- `atr_median` = median of the non-null `atr` values of up to `regime_window` prior bars; null with fewer than 20 values.
- `volatility_regime` = `low` if atr / atr_median < `regime_low`, `high` if > `regime_high`, else `normal`; `indeterminate` if atr or atr_median is null or the median is zero.
- `trend_slope` = ordinary least-squares slope of the closes of the lookback history window, in price per bar. `trend_move_atr` = `trend_slope` x (history length - 1) / `atr` (fitted move in ATRs); null if atr is null or zero, or history is shorter than `minimum_history`.
- `background`: with `close_difference` it is the previous rule (last minus first close of the history window: up, down, or indeterminate). With `slope` it is `up` if `trend_move_atr` >= `trend_atr_threshold`, `down` if <= -threshold, `flat` in between, and `indeterminate` if `trend_move_atr` is null (including zero ATR).
- New per-bar feature keys: `atr`, `atr_median`, `volatility_regime`, `trend_slope`, `trend_move_atr`. Existing keys are unchanged.

Default change: `background` now uses `slope`. Pass `trend_method=close_difference` for the previous results. Stored analyses saved before this step are read with `trend_method=close_difference`; stored data is not rewritten.
