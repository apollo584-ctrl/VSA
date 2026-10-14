/**
 * Runtime schemas for the analysis API.
 *
 * The backend (owned by Codex) is the single source of analytical truth. These schemas describe the
 * response shapes the frontend expects; they are documented in docs/FRONTEND_API_REQUIREMENTS.md and must be
 * reconciled with docs/API_CONTRACT.md once the backend publishes it.
 */
import { z } from "zod";

export const TIMEFRAMES = ["30m", "1D"] as const;
export const SESSIONS = ["RTH", "ETH", "ALL"] as const;
export const timeframeSchema = z.string();
export const sessionSchema = z.string();

// ---------- Instruments & datasets ----------
export const datasetSourceSchema = z.object({
  name: z.string(),
  /** "historical" = stored bars; "fixture" = frontend/mock data; "live" = streaming (never assumed). */
  kind: z.enum(["historical", "fixture", "live"]),
  provider: z.string().optional(),
  note: z.string().optional(),
});

export const instrumentSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  exchange: z.string().optional(),
  timeframes: z.array(z.string()),
  sessions: z.array(z.string()),
  availableDates: z.array(z.string()), // YYYY-MM-DD
  source: datasetSourceSchema,
});

export const instrumentListSchema = z.object({ instruments: z.array(instrumentSchema) });

// ---------- Bars ----------
export const barSchema = z.object({
  t: z.number(), // unix seconds, bar open time (UTC)
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});

export const qualityIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
});

export const dataQualitySchema = z.object({
  issues: z.array(qualityIssueSchema),
  barCount: z.number(),
  firstBarAt: z.number().nullable(),
  lastBarAt: z.number().nullable(),
  /** Backend's own staleness judgement relative to the requested asOf / data end. */
  stale: z.boolean(),
  hasVolume: z.boolean(),
  /** True when intraday volume-at-price is not available and profiles are derived from OHLCV. */
  profileEstimated: z.boolean(),
});

export const barsResponseSchema = z.object({
  symbol: z.string(),
  timeframe: z.string(),
  session: z.string(),
  source: datasetSourceSchema,
  generatedAt: z.string(),
  bars: z.array(barSchema),
  quality: dataQualitySchema,
});

// ---------- Profiles ----------
export const profileKindSchema = z.enum(["tpo", "volume", "developing", "prior", "composite"]);
export const profileShapeTypeSchema = z.enum(["D", "P", "b", "B", "trend", "multi", "undetermined"]);

export const profileBinSchema = z.object({
  price: z.number(),
  tpo: z.number(),
  volume: z.number(),
});

export const distributionSchema = z.object({
  low: z.number(),
  high: z.number(),
  poc: z.number(),
  label: z.string().optional(),
});

export const migrationPointSchema = z.object({
  date: z.string(),
  poc: z.number(),
  vah: z.number(),
  val: z.number(),
});

export const profileSchema = z.object({
  kind: profileKindSchema,
  /** Required: whether volume-at-price is estimated (e.g. from OHLCV bars) rather than exact. */
  estimated: z.boolean(),
  estimationMethod: z.string().nullable().optional(),
  label: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  binSize: z.number(),
  bins: z.array(profileBinSchema),
  poc: z.number(),
  vah: z.number(),
  val: z.number(),
  hvns: z.array(z.number()),
  lvns: z.array(z.number()),
  sessionHigh: z.number(),
  sessionLow: z.number(),
  initialBalance: z.object({ high: z.number(), low: z.number() }).nullable().optional(),
  shape: z.object({
    type: profileShapeTypeSchema,
    confidence: z.number().min(0).max(1),
    knowledgeSlug: z.string().nullable().optional(),
    distributions: z.array(distributionSchema),
    rationale: z.array(z.string()),
  }),
  valueMigration: z.array(migrationPointSchema),
  /** Bar-by-bar POC/VAH/VAL as the session developed (present for "developing" profiles). */
  developingTrack: z.array(z.object({ time: z.number(), poc: z.number(), vah: z.number(), val: z.number() })).optional(),
});

// ---------- VSA ----------
export const vsaPatternTypeSchema = z.enum([
  "upthrust",
  "shakeout",
  "stopping_volume",
  "buying_climax",
  "selling_climax",
  "no_demand",
  "no_supply",
  "test_of_supply",
  "high_volume_churn",
  "effort_vs_result",
  "volume_divergence",
]);

export const detectionStatusSchema = z.enum(["provisional", "confirmed", "invalidated", "historical"]);

export const vsaEventSchema = z.object({
  id: z.string(),
  type: vsaPatternTypeSchema,
  barTime: z.number(),
  rangeStart: z.number().optional(),
  rangeEnd: z.number().optional(),
  /** When the engine could first have known about this event (no look-ahead before this). */
  detectedAt: z.number(),
  status: detectionStatusSchema,
  /** Status transitions with timestamps so the UI can show "what was known when". */
  statusHistory: z.array(z.object({ status: detectionStatusSchema, at: z.number(), reason: z.string().optional() })),
  measurements: z.object({
    spread: z.number(),
    spreadVsAvg: z.number().describe("spread ÷ average spread"),
    relativeVolume: z.number().describe("volume ÷ average volume"),
    closeLocation: z.number().min(0).max(1).describe("0 = close at low, 1 = close at high"),
    priorTrend: z.enum(["up", "down", "sideways", "unknown"]),
    priceLocation: z.string(),
  }),
  conditions: z.array(z.object({ label: z.string(), met: z.boolean(), detail: z.string() })),
  implications: z.array(z.string()),
  alternatives: z.array(z.string()),
  confirmation: z.array(z.string()),
  invalidation: z.array(z.string()),
  profileRefs: z.array(z.enum(["poc", "vah", "val", "hvn", "lvn", "ib_high", "ib_low", "session_high", "session_low"])),
  referencePrices: z.array(z.number()),
  knowledgeSlugs: z.array(z.string()),
});

// ---------- Auction structure ----------
export const auctionStateKindSchema = z.enum([
  "balance",
  "breakout_attempt",
  "acceptance",
  "rejection",
  "failed_auction",
  "value_migration",
  "trend_development",
  "distribution_transition",
]);

export const evidenceItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["profile", "vsa", "price_action", "volume", "structure", "data"]),
  text: z.string(),
  measurement: z.string().optional(),
  at: z.number().optional(),
});

export const auctionStateSchema = z.object({
  id: z.string(),
  kind: auctionStateKindSchema,
  startTime: z.number(),
  endTime: z.number().nullable(),
  detectedAt: z.number(),
  priceLow: z.number().optional(),
  priceHigh: z.number().optional(),
  summary: z.string(),
});

export const auctionTransitionSchema = z.object({
  id: z.string(),
  fromStateId: z.string().nullable(),
  toStateId: z.string(),
  at: z.number(),
  detectedAt: z.number(),
  rationale: z.string(),
  evidence: z.array(evidenceItemSchema),
});

// ---------- Levels ----------
export const levelSchema = z.object({
  id: z.string(),
  kind: z.enum(["prior_vah", "prior_val", "prior_poc", "prior_high", "prior_low", "ib_high", "ib_low", "hvn", "lvn", "swing_high", "swing_low", "other"]),
  price: z.number(),
  label: z.string(),
  note: z.string().optional(),
});

// ---------- Interpretation ----------
export const narrativeSchema = z.object({
  quick: z.string(),
  standard: z.string(),
  deep: z.array(z.string()),
});

export const scenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  supportedBy: z.array(z.string()), // evidence ids
  challengedBy: z.array(z.string()),
  knowledgeSlugs: z.array(z.string()),
});

export const watchItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  strengthens: z.array(z.string()), // scenario ids
  weakens: z.array(z.string()),
});

export const uncertaintySchema = z.object({
  kind: z.enum(["missing_data", "estimated_profile", "ambiguous_pattern", "provisional", "small_sample", "other"]),
  text: z.string(),
});

export const interpretationSchema = z.object({
  asOf: z.number(),
  whatIsHappening: narrativeSchema,
  whyItMatters: narrativeSchema,
  context: narrativeSchema,
  profile: narrativeSchema,
  vsa: narrativeSchema,
  priceAction: narrativeSchema,
  supporting: z.array(evidenceItemSchema),
  contradicting: z.array(evidenceItemSchema),
  scenarios: z.array(scenarioSchema),
  watchNext: z.array(watchItemSchema),
  uncertainty: z.array(uncertaintySchema),
  evidenceBalance: z.enum(["consistent", "mixed", "contradictory", "insufficient"]),
});

export const valueLocationSchema = z.object({
  price: z.number(),
  relativeTo: z.enum(["above_value", "inside_value", "below_value", "unknown"]),
  referenceProfile: z.string(),
  distanceFromPocPct: z.number().nullable(),
});

// ---------- Analysis snapshot ----------
export const analysisSchema = z.object({
  symbol: z.string(),
  timeframe: z.string(),
  session: z.string(),
  asOf: z.number(),
  generatedAt: z.string(),
  source: datasetSourceSchema,
  /** Timeframe the engine actually analysed (may differ from the displayed chart timeframe). */
  analysisTimeframe: z.string().optional(),
  /** Server-side state: ok, or why analysis could not be produced. */
  status: z.enum(["ok", "insufficient_data", "invalid_data"]),
  statusMessage: z.string().nullable().optional(),
  quality: dataQualitySchema,
  profiles: z.record(z.string(), profileSchema),
  valueLocation: valueLocationSchema.nullable(),
  vsaEvents: z.array(vsaEventSchema),
  auctionStates: z.array(auctionStateSchema),
  auctionTransitions: z.array(auctionTransitionSchema),
  levels: z.array(levelSchema),
  interpretation: interpretationSchema.nullable(),
});

// ---------- Knowledge ----------
export const knowledgeCategorySchema = z.enum([
  "market_profile_shapes",
  "market_profile_concepts",
  "volume_profile",
  "vsa_patterns",
  "auction_market_theory",
  "price_action",
  "volume_and_volatility",
  "pattern_relationships",
]);

export const knowledgeConceptSchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: knowledgeCategorySchema,
  summary: z.string(),
  definition: z.string(),
  schematic: z.object({ kind: z.enum(["profile_shape", "candle", "timeline", "none"]), variant: z.string().optional() }),
  detection: z.array(z.string()),
  marketContext: z.string(),
  implications: z.array(z.string()),
  alternatives: z.array(z.string()),
  confirmation: z.array(z.string()),
  invalidation: z.array(z.string()),
  doesNotProve: z.array(z.string()).optional(),
  related: z.array(
    z.object({
      slug: z.string(),
      relation: z.enum(["often_precedes", "may_lead_to", "contradicts", "contrasts_with", "component_of", "see_also"]),
      note: z.string().optional(),
    }),
  ),
  sources: z.array(z.object({ title: z.string(), note: z.string().optional() })),
});

export const knowledgeListSchema = z.object({ concepts: z.array(knowledgeConceptSchema) });

// ---------- Upload ----------
export const uploadResultSchema = z.object({
  accepted: z.boolean(),
  datasetId: z.string().nullable(),
  issues: z.array(qualityIssueSchema),
});

// ---------- API error envelope ----------
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
