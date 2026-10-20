/**
 * Raw response schemas for the Codex backend, mirroring backend/app/models.py (docs/API_CONTRACT.md).
 * Strict about what the UI relies on; tolerant (passthrough) about additions, which the contract allows within v1.
 */
import { z } from "zod";

const num = z.number();
const iso = z.string();
const scalar = z.union([z.number(), z.string(), z.null()]);

export const rawSourceSchema = z.object({
  instrument: z.string(),
  timeframe_minutes: z.number(),
  exchange: z.string(),
  session_mode: z.enum(["regular", "extended"]),
  timestamp_convention: z.enum(["bar_start", "bar_end"]),
  timezone: z.string(),
  price_adjustment: z.string(),
  volume_adjustment: z.string(),
  source_name: z.string(),
  is_demo: z.boolean(),
});

export const rawQualitySchema = z.object({
  warnings: z.array(z.string()),
  missing_bars: z.number(),
  absent_sessions: z.array(z.string()),
  incomplete_sessions: z.array(z.string()),
  split_suspected: z.boolean(),
});

export const rawSessionResetSchema = z.object({
  id: z.string(),
  kind: z.literal("session_reset"),
  reason: z.literal("new_session"),
  session: z.string(),
  previous_session: z.string(),
  timestamp: iso,
  first_observable_at: iso,
  previous_state: z.string(),
  state: z.string(),
  reference_session: z.string().nullable(),
  reference_usable: z.boolean(),
  reference_unavailable_reason: z.string().nullable().optional(),
  description: z.string(),
});

export const rawValueLocationSchema = z.object({
  state: z.enum(["above_value", "inside_value", "below_value", "unavailable"]),
  price: z.number(),
  price_basis: z.literal("bar_close"),
  as_of: iso,
  reference_session: z.string().nullable().optional(),
  val: z.number().nullable().optional(),
  vah: z.number().nullable().optional(),
  poc: z.number().nullable().optional(),
  unavailable_reason: z.string().nullable().optional(),
});

export const rawDevelopingProfileSchema = z.object({
  session: z.string(), method: z.literal("volume"),
  points: z.array(z.object({ timestamp: iso, available_at: iso, poc: z.number(), vah: z.number(), val: z.number() })),
});
export const rawValueMigrationStepSchema = z.object({
  session: z.string(), previous_session: z.string().nullable(),
  relationship: z.enum(["higher_value", "lower_value", "overlapping_higher", "overlapping_lower", "overlapping_unchanged"]).nullable(),
  unavailable_reason: z.string().nullable().optional(), final: z.boolean(),
  poc: z.number().nullable(), vah: z.number().nullable(), val: z.number().nullable(),
  prior_poc: z.number().nullable().optional(), prior_vah: z.number().nullable().optional(), prior_val: z.number().nullable().optional(),
});

export const rawDatasetSchema = z.object({
  id: z.string(),
  content_sha256: z.string(),
  source: rawSourceSchema,
  created_at: iso,
  row_count: z.number(),
  first_timestamp: iso,
  last_available_at: iso,
  quality: rawQualitySchema,
});

export const rawInstrumentsSchema = z.object({
  items: z.array(z.object({ instrument: z.string(), dataset_ids: z.array(z.string()) }).passthrough()),
});

export const rawBarSchema = z.object({
  timestamp: iso,
  available_at: iso,
  session: z.string(),
  open: num, high: num, low: num, close: num, volume: num,
});

export const rawEvidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(["observed", "classified"]),
  concept_id: z.string(),
  timestamp: iso,
  first_observable_at: iso,
  confirmed_at: iso.nullable().optional(),
  invalidated_at: iso.nullable().optional(),
  expired_at: iso.nullable().optional(),
  resolved_at: iso.nullable().optional(),
  status_history: z.array(z.object({
    status: z.enum(["observed", "provisional", "confirmed", "invalidated", "expired"]),
    at: iso, reason: z.string(),
  })).optional(),
  conditions_met: z.array(z.object({
    id: z.string(), label: z.string(), metric: z.string(),
    actual: z.union([z.number(), z.string(), z.boolean(), z.null()]),
    operator: z.enum([">", ">=", "<", "<=", "==", "in"]),
    expected: z.union([z.number(), z.string(), z.boolean(), z.array(z.string()), z.null()]),
    reference: z.string().nullable().optional(), met: z.boolean().nullable(),
  })).optional(),
  status: z.enum(["observed", "provisional", "confirmed", "invalidated", "expired"]),
  direction: z.enum(["strength", "weakness", "neutral"]),
  description: z.string(),
  coordinates: z.record(z.string(), scalar),
  measurements: z.record(z.string(), scalar),
  supporting_evidence: z.array(z.string()),
  // Absent or null in snapshots saved before price location was recorded; never reconstructed.
  value_location: rawValueLocationSchema.nullable().optional(),
});

const rawShapeSchema = z.object({
  classification: z.string(),
  ambiguity: z.enum(["low", "high"]),
  features: z.record(z.string(), z.number()),
  alternatives: z.array(z.string()),
  interpretation: z.string(),
  limitations: z.array(z.string()),
});

const rawDistributionSchema = z.object({
  method: z.string(),
  estimated: z.boolean(),
  counts: z.array(z.number()),
  poc: z.number().nullable(),
  vah: z.number().nullable(),
  val: z.number().nullable(),
  achieved_value_fraction: z.number().nullable(),
  shape: rawShapeSchema,
});

export const rawProfileSchema = z.object({
  id: z.string(),
  session: z.string(),
  scope: z.enum(["session", "composite"]),
  as_of: iso,
  bin_size: z.number(),
  price_bin_lower: z.array(z.number()),
  price_bin_center: z.array(z.number()),
  tpo: rawDistributionSchema,
  volume: rawDistributionSchema,
  hvns: z.array(z.number()),
  lvns: z.array(z.number()),
  single_print_bins: z.array(z.number()),
  initial_balance: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  range_extension: z.record(z.string(), z.number().nullable()),
  extremes: z.record(z.string(), z.string()),
  limitations: z.array(z.string()),
});

const rawScenarioSchema = z.object({
  id: z.string(),
  kind: z.literal("inferred"),
  description: z.string(),
  evidence_ids: z.array(z.string()),
  confirmation_conditions: z.array(z.string()),
  invalidation_conditions: z.array(z.string()),
});

export const rawAnalysisSchema = z.object({
  id: z.string().nullable(),
  persisted: z.boolean().default(true),
  engine_version: z.string(),
  knowledge_version: z.string(),
  // Legacy persisted snapshots predate this optional field.
  knowledge_snapshot: z.lazy(() => z.object({ version: z.string(), concepts: z.array(rawConceptSchema) })).nullable().optional(),
  dataset_id: z.string(),
  instrument: z.string(),
  timeframe: z.string(),
  analysis_timestamp: iso,
  created_at: iso,
  provenance: rawSourceSchema,
  parameters: z.record(z.string(), z.unknown()),
  data_quality: rawQualitySchema,
  market_context: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  value_location: rawValueLocationSchema.nullable().optional(),
  // Absent or null in snapshots saved before these were recorded; never reconstructed.
  developing_profile: rawDevelopingProfileSchema.nullable().optional(),
  value_migration: z.array(rawValueMigrationStepSchema).nullable().optional(),
  profile_analysis: z.array(rawProfileSchema),
  composite_profile: rawProfileSchema.nullable().optional(),
  composite_unavailable_reason: z.string().nullable().optional(),
  vsa_observations: z.array(rawEvidenceSchema),
  price_action_observations: z.array(rawEvidenceSchema),
  // Absent or null in snapshots saved before resets were recorded; never reconstructed.
  auction_state: z.object({ state: z.string(), evidence_ids: z.array(z.string()), transitions: z.array(rawEvidenceSchema), session_resets: z.array(rawSessionResetSchema).nullable().optional() }),
  supporting_evidence: z.array(z.string()),
  contradicting_evidence: z.array(z.string()),
  interpretations: z.array(rawScenarioSchema),
  alternative_scenarios: z.array(rawScenarioSchema),
  confirmation_conditions: z.array(z.string()),
  invalidation_conditions: z.array(z.string()),
  uncertainties: z.array(z.string()),
  plain_english_summary: z.string(),
}).superRefine((a, ctx) => {
  if (a.persisted !== (a.id !== null)) ctx.addIssue({ code: "custom", path: ["id"], message: "Saved analyses require an id; previews require a null id" });
});

export const rawConceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  definition: z.string(),
  historical_origin_or_source: z.array(z.string()),
  observable_conditions: z.array(z.string()),
  required_background: z.array(z.string()),
  preferred_price_location: z.array(z.string()),
  volume_characteristics: z.array(z.string()),
  spread_characteristics: z.array(z.string()),
  close_location_characteristics: z.array(z.string()),
  possible_interpretations: z.array(z.string()),
  alternative_explanations: z.array(z.string()),
  confirmation_conditions: z.array(z.string()),
  invalidation_conditions: z.array(z.string()),
  known_limitations: z.array(z.string()),
  related_patterns: z.array(z.string()),
  detector_status: z.enum(["implemented", "knowledge_only"]),
});

export const rawScanStatusSchema = z.object({
  running: z.boolean(), started_at: iso.nullable().optional(), finished_at: iso.nullable().optional(),
  total: z.number(), done: z.number(), auto_minutes: z.number(), universe_size: z.number(),
});
export const rawScanResultSchema = z.object({
  symbol: z.string(), name: z.string(), sector: z.string(),
  status: z.enum(["ok", "error"]), direction: z.enum(["strength", "weakness", "none"]), agreeing: z.number(),
  votes: z.array(z.object({ factor: z.enum(["value_location", "auction_state", "vsa", "price_action"]), vote: z.union([z.literal(-1), z.literal(0), z.literal(1)]), text: z.string() })),
  last_close: z.number().nullable().optional(), last_bar_at: iso.nullable().optional(), scanned_at: iso, error: z.string().nullable().optional(),
});
export const rawScanSchema = z.object({ status: rawScanStatusSchema, results: z.array(rawScanResultSchema) });
export type RawScan = z.infer<typeof rawScanSchema>;
export type RawScanResult = z.infer<typeof rawScanResultSchema>;
export type RawScanStatus = z.infer<typeof rawScanStatusSchema>;

export type RawSource = z.infer<typeof rawSourceSchema>;
export type RawQuality = z.infer<typeof rawQualitySchema>;
export type RawDataset = z.infer<typeof rawDatasetSchema>;
export type RawBar = z.infer<typeof rawBarSchema>;
export type RawValueLocation = z.infer<typeof rawValueLocationSchema>;
export type RawEvidence = z.infer<typeof rawEvidenceSchema>;
export type RawProfile = z.infer<typeof rawProfileSchema>;
export type RawAnalysis = z.infer<typeof rawAnalysisSchema>;
export type RawConcept = z.infer<typeof rawConceptSchema>;

export const rawJobStatusSchema = z.object({
  running: z.boolean(), started_at: iso.nullable().optional(), finished_at: iso.nullable().optional(),
  total: z.number(), done: z.number(), errors: z.number(), bars_added: z.number().optional(), error: z.string().nullable().optional(),
});
export const rawOutcomeStatSchema = z.object({
  concept: z.string(), direction: z.enum(["strength", "weakness"]), horizon: z.number(), period: z.enum(["older", "newer"]),
  n_cases: z.number(), n_raw: z.number().optional(), hit_rate: z.number(), baseline_hit_rate: z.number(), edge: z.number(),
  mean_return: z.number().optional(), holds: z.boolean(),
});
export const rawOutcomeStudySchema = z.object({
  generated_at: iso, symbols_used: z.array(z.string()), date_range: z.object({ start: z.string().nullable(), end: z.string().nullable() }),
  cutoff_date: z.string().nullable().optional(), horizons: z.array(z.number()), min_cases: z.number(),
  stats: z.array(rawOutcomeStatSchema), holds: z.array(z.object({ concept: z.string(), horizon: z.number(), holds: z.boolean() })),
  method_notes: z.array(z.string()).optional(),
});
export const rawOutcomesSchema = z.object({ status: rawJobStatusSchema, study: rawOutcomeStudySchema.nullable() });
export const rawIntradaySchema = z.object({
  status: rawJobStatusSchema,
  summary: z.object({
    symbols: z.number(), bars: z.number(), first_ts: iso.nullable().optional(), last_ts: iso.nullable().optional(),
    rebased_symbols: z.number(), last_collected_at: iso.nullable().optional(),
  }),
});
export type RawJobStatus = z.infer<typeof rawJobStatusSchema>;
export type RawOutcomeStat = z.infer<typeof rawOutcomeStatSchema>;
export type RawOutcomes = z.infer<typeof rawOutcomesSchema>;
export type RawIntraday = z.infer<typeof rawIntradaySchema>;

export const rawAuthStatusSchema = z.object({ local: z.boolean(), pin_set: z.boolean(), authenticated: z.boolean() });
export type RawAuthStatus = z.infer<typeof rawAuthStatusSchema>;
