# Knowledge schema — 1.0.0

Machine-readable catalog: `backend/app/knowledge/concepts.json`. `Knowledge` and `Concept` Pydantic v2 models validate the catalog at app startup, reject unknown fields, require all fields, verify unique IDs and resolve relationships. The checked-in JSON is runtime input; the optional `scripts/build_knowledge.py` regenerates the initial authored catalog. Edit the JSON directly for later additions, or update the generator consistently before regenerating it. Catalog changes must increment its version and the engine's reported knowledge version.

Each concept contains:

| Field | Type and role |
|---|---|
| id | Stable snake_case ID; also the observation concept_id |
| name | Display name |
| category | strength, weakness, neutral, profile, auction, price_action, data or limitations |
| definition | Operational meaning |
| historical_origin_or_source | Reference URLs and local rule provenance |
| observable_conditions | Measurable requirements |
| required_background | Context necessary for interpretation |
| preferred_price_location | Relevant location/context |
| volume_characteristics | Volume measurement assumptions |
| spread_characteristics | Range conditions |
| close_location_characteristics | Close-position conditions |
| possible_interpretations | Hypotheses, never established intent |
| alternative_explanations | Competing explanations |
| confirmation_conditions | Subsequent distinguishing behavior |
| invalidation_conditions | Behavior weakening the hypothesis |
| known_limitations | Data/semantic/measurement limitations |
| related_patterns | Resolvable concept IDs |
| detector_status | implemented or knowledge_only |

All fields from `historical_origin_or_source` through `related_patterns` are string arrays. Explanatory knowledge can expand without altering detectors. Adding a new rule still requires detector implementation and tests; a new concept alone never enables detection.

Sources provide conceptual background, not validation of local thresholds. Wyckoff concepts are referenced to [Wyckoff Analytics' methodology](https://www.wyckoffanalytics.com/wyckoff-method/). Profile vocabulary is referenced to [CQG's Trading Time profile material](https://www.cqg.com/sites/default/files/archive/docs/Trading_Time.pdf). Exchange scheduling uses the [exchange_calendars project](https://github.com/gerrymanoim/exchange_calendars). VSA-style operational proxies, their thresholds and classification/lifecycle logic are authored locally and explicitly marked as heuristics. No verbatim proprietary pattern library or claimed source-author numeric calibration is included.

Output authority is separated into observed numbers, deterministic classifications, inferred scenarios with evidence IDs, and explicit uncertainty. Profile shape labels do not prove covering, liquidation, accumulation or distribution. Estimated volume-at-price and range-based TPO must always keep their estimation labels.

Every new analysis preserves a deep copy of this catalog in `knowledge_snapshot`, alongside `knowledge_version`. Later catalog edits cannot alter a stored snapshot's explanatory text. Legacy snapshots without the embedded catalog remain readable; historical generic concept explanations are unavailable rather than filled from today's catalog.
