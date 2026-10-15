/**
 * Pure mappers: Codex backend responses → the UI's internal types.
 *
 * Rules:
 *  - Never invent analytical content. A field the backend does not supply becomes null/absent and the UI says so.
 *  - Time convention: the UI addresses a bar by its START time. Backend "known at" instants (available_at,
 *    first_observable_at, analysis_timestamp) are bar ENDS, so they are mapped back by one bar interval:
 *    detectedAt = first_observable_at − interval. A bar that starts at T is therefore "known" at asOf = T.
 *  - Every mismatch is documented in docs/BACKEND_INTEGRATION.md.
 */
import type {
  Analysis, AuctionReset, AuctionState, AuctionTransition, Bar, BarsResponse, DataQuality, DatasetSource, EvidenceItem, Instrument, Interpretation,
  KnowledgeConcept, Level, Profile, Scenario, VsaEvent,
} from "@/types";
import { fmtPrice, humanize } from "@/lib/formatting";
import type { RawAnalysis, RawBar, RawConcept, RawDataset, RawEvidence, RawProfile, RawQuality, RawSource } from "./schemas";

export const epoch = (iso: string): number => Date.parse(iso) / 1000;
const intervalSec = (s: RawSource) => s.timeframe_minutes * 60;

export function mapSource(s: RawSource): DatasetSource {
  return {
    name: s.source_name,
    kind: s.is_demo ? "fixture" : "historical",
    provider: s.instrument,
    note: `${s.is_demo ? "Uploader-declared demo/synthetic data. " : "Uploader-declared source. "}Adjustments: price ${s.price_adjustment}, volume ${s.volume_adjustment} (not independently verified).`,
  };
}

export function mapBars(raw: RawBar[]): Bar[] {
  return raw.map((b) => ({ t: epoch(b.timestamp), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
}

export function mapQuality(q: RawQuality, bars: RawBar[], profileEstimated: boolean): DataQuality {
  // The backend appends this provenance statement to every dataset. It describes what is not verified, not a defect in
  // the data, so it is shown as information rather than raising the warning badge on every chart.
  const issues: DataQuality["issues"] = q.warnings.map((m) => /^Adjustment metadata is uploader-declared/.test(m)
    ? { code: "adjustment_unverified", severity: "info" as const, message: m }
    : { code: "data_quality_warning", severity: "warning" as const, message: m });
  if (q.missing_bars > 0) issues.push({ code: "missing_bars", severity: "warning", message: `${q.missing_bars} scheduled bar(s) are missing; gaps are reported, never filled.` });
  if (q.absent_sessions.length) issues.push({ code: "absent_sessions", severity: "warning", message: `Absent sessions: ${q.absent_sessions.join(", ")}.` });
  if (q.incomplete_sessions.length) issues.push({ code: "incomplete_sessions", severity: "info", message: `Incomplete sessions: ${q.incomplete_sessions.join(", ")}.` });
  if (q.split_suspected) issues.push({ code: "split_suspected", severity: "error", message: "A possible split or large price discontinuity was detected; profile and analysis calculation is blocked." });
  return {
    issues,
    barCount: bars.length,
    firstBarAt: bars[0] ? epoch(bars[0].timestamp) : null,
    lastBarAt: bars.length ? epoch(bars[bars.length - 1]!.timestamp) : null,
    // The backend reports no freshness judgement; it states only that data is never live.
    stale: false,
    hasVolume: bars.some((b) => b.volume > 0),
    profileEstimated,
  };
}

export function mapDatasetToInstrument(d: RawDataset, bars: RawBar[]): Instrument {
  const tf = `${d.source.timeframe_minutes}m`;
  return {
    symbol: d.id,
    name: `${d.source.instrument} · ${tf} · ${d.source.session_mode} session · ${d.source.source_name}`,
    label: `${d.source.instrument} · ${tf}${d.source.is_demo ? " · demo" : ""}`,
    exchange: d.source.exchange,
    timeframes: [tf],
    sessions: [d.source.session_mode === "regular" ? "RTH" : "ETH"],
    availableDates: [...new Set(bars.map((b) => b.session))].sort(),
    source: mapSource(d.source),
  };
}

export function barsResponse(d: RawDataset, bars: RawBar[]): BarsResponse {
  return {
    symbol: d.id,
    timeframe: `${d.source.timeframe_minutes}m`,
    session: d.source.session_mode === "regular" ? "RTH" : "ETH",
    source: mapSource(d.source),
    generatedAt: d.created_at,
    bars: mapBars(bars),
    quality: mapQuality(d.quality, bars, true),
  };
}

// ------------------------------------------------------------------ knowledge

export function mapConcept(c: RawConcept): KnowledgeConcept {
  const extra: NonNullable<KnowledgeConcept["extraSections"]> = [
    { title: "Required background", items: c.required_background },
    { title: "Preferred price location", items: c.preferred_price_location },
    { title: "Volume characteristics", items: c.volume_characteristics },
    { title: "Spread characteristics", items: c.spread_characteristics },
    { title: "Close-location characteristics", items: c.close_location_characteristics },
  ].filter((s) => s.items.length);
  return {
    slug: c.id,
    name: c.name,
    category: c.category,
    summary: c.definition.split(/\.(?:\s|$)/)[0] ?? c.definition,
    definition: c.definition,
    schematic: { kind: "none" },
    detection: c.observable_conditions,
    marketContext: "",
    implications: c.possible_interpretations,
    alternatives: c.alternative_explanations,
    confirmation: c.confirmation_conditions,
    invalidation: c.invalidation_conditions,
    doesNotProve: c.known_limitations,
    detectorStatus: c.detector_status,
    extraSections: extra,
    related: c.related_patterns.map((slug) => ({ slug, relation: "see_also" as const })),
    sources: c.historical_origin_or_source.map((title) => ({ title })),
  };
}

// ------------------------------------------------------------------ evidence

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function priorTrend(v: unknown): "up" | "down" | "sideways" | "unknown" {
  return v === "up" || v === "down" || v === "sideways" ? v : "unknown";
}

function mapStatusHistory(e: RawEvidence, interval: number): VsaEvent["statusHistory"] {
  if (e.status_history?.length) return e.status_history.map((h) => ({ ...h, at: epoch(h.at) - interval }));
  const first = epoch(e.first_observable_at) - interval;
  const hist: VsaEvent["statusHistory"] = [{ status: e.status === "observed" ? "observed" : "provisional", at: first, reason: "First observable once the bar completed." }];
  if (e.confirmed_at) hist.push({ status: "confirmed", at: epoch(e.confirmed_at) - interval, reason: "Subsequent same-session close beyond the candidate's extreme." });
  else if (e.status === "invalidated" || e.status === "expired") {
    const r = (e.status === "invalidated" ? e.invalidated_at : e.expired_at) ?? e.resolved_at ?? e.measurements["resolved_at"];
    if (typeof r === "string") hist.push({ status: e.status, at: epoch(r) - interval, reason: e.status === "invalidated" ? "A close through the opposite extreme." : "Confirmation horizon elapsed without follow-through." });
  }
  return hist;
}

export function mapVsaEvent(e: RawEvidence, interval: number, concepts: Map<string, RawConcept>): VsaEvent {
  const m = e.measurements;
  const c = concepts.get(e.concept_id);
  const raw: Record<string, number | string | null> = { ...m };
  const barStart = epoch(e.timestamp);
  return {
    id: e.id,
    type: e.concept_id,
    barTime: barStart,
    detectedAt: epoch(e.first_observable_at) - interval,
    status: e.status,
    statusHistory: mapStatusHistory(e, interval),
    kind: e.kind,
    direction: e.direction,
    description: e.description,
    measurements: {
      spread: num(m["spread"]),
      spreadVsAvg: num(m["relative_spread"]),
      relativeVolume: num(m["relative_volume"]),
      closeLocation: num(m["close_location"]),
      priorTrend: priorTrend(m["background"]),
      priceLocation: null,
      raw,
    },
    conditions: e.conditions_met?.length ? e.conditions_met.map((condition) => ({
      ...condition,
      detail: `${condition.metric}: ${conditionValue(condition.actual)} ${condition.operator} ${conditionValue(condition.expected)}${condition.reference ? ` (${condition.reference})` : ""}`,
    })) : (c?.observable_conditions ?? []).map((label) => ({ label, met: null, detail: "" })),
    conditionSource: e.conditions_met?.length ? "instance" : c ? "catalog" : "unavailable",
    implications: c?.possible_interpretations ?? [],
    alternatives: c?.alternative_explanations ?? [],
    confirmation: c?.confirmation_conditions ?? [],
    invalidation: c?.invalidation_conditions ?? [],
    textSource: c ? "catalog" : "unavailable",
    profileRefs: [],
    referencePrices: Object.values(e.coordinates).filter((v): v is number => typeof v === "number"),
    knowledgeSlugs: c ? [c.id, ...c.related_patterns.slice(0, 3)] : [e.concept_id],
  };
}

// ------------------------------------------------------------------ profiles

function sessionExtremes(bars: RawBar[], session: string, upTo: number, composite = false) {
  const [first, last = first] = session.split("/");
  const inSession = bars.filter((b) => (composite ? b.session >= first! && b.session <= last! : b.session === session) && epoch(b.available_at) <= upTo);
  return {
    high: inSession.length ? Math.max(...inSession.map((b) => b.high)) : null,
    low: inSession.length ? Math.min(...inSession.map((b) => b.low)) : null,
    first: inSession[0] ? epoch(inSession[0].timestamp) : null,
    last: inSession.length ? epoch(inSession[inSession.length - 1]!.timestamp) : null,
  };
}

/** Free-text label for the classification string (the backend's own words, humanized). */
export const shapeLabel = (c: string) => c.replace(/_/g, " "); // keep case: P / b / D / B are meaningful

export function mapProfile(p: RawProfile, kind: "tpo" | "volume" | "prior" | "composite", bars: RawBar[], upTo: number, label: string, concepts: Map<string, RawConcept>): Profile | null {
  const weightDist = kind === "tpo" ? p.tpo : p.volume;
  if (weightDist.poc === null || weightDist.vah === null || weightDist.val === null) return null; // e.g. zero volume: levels are null
  const ex = sessionExtremes(bars, p.session, Math.min(upTo, epoch(p.as_of)), p.scope === "composite");
  // Missing constituent bars cannot be replaced by bin coordinates or epoch dates.
  if (ex.first === null || ex.last === null || ex.high === null || ex.low === null) return null;
  const ib = p.initial_balance;
  const hasIb = typeof ib["high"] === "number" && typeof ib["low"] === "number";
  const sh = weightDist.shape;
  const lows = p.price_bin_center;
  return {
    kind,
    estimated: weightDist.estimated,
    estimationMethod: weightDist.method,
    label,
    startTime: ex.first,
    endTime: ex.last,
    binSize: p.bin_size,
    bins: lows.map((price, i) => ({ price, tpo: p.tpo.counts[i] ?? 0, volume: p.volume.counts[i] ?? 0 })),
    poc: weightDist.poc, vah: weightDist.vah, val: weightDist.val,
    hvns: p.hvns, lvns: p.lvns,
    sessionHigh: ex.high,
    sessionLow: ex.low,
    initialBalance: hasIb ? { high: ib["high"] as number, low: ib["low"] as number } : null,
    shape: {
      type: sh.classification,
      confidence: null,
      ambiguity: sh.ambiguity,
      knowledgeSlug: concepts.has("profile_shapes") ? "profile_shapes" : null,
      distributions: [],
      rationale: [sh.interpretation],
      alternatives: sh.alternatives,
      features: sh.features,
      limitations: sh.limitations,
    },
    limitations: [...p.limitations, ...(ib["complete"] === false ? ["Initial balance window is not yet complete; range extensions remain null until it is."] : [])],
    singlePrints: p.single_print_bins,
    valueMigration: [],
  };
}

// ------------------------------------------------------------------ auction

/** Measured values in a condition receipt, to three decimals (thresholds such as 0.65 stay exact). Display only. */
const conditionValue = (v: unknown) => (typeof v === "number" && !Number.isInteger(v) ? String(Number(v.toFixed(3))) : JSON.stringify(v));

/** Display form of a backend value: whole numbers as-is, other numbers to two decimals. Never changes stored data. */
const readable = (v: unknown) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v));

export function mapAuction(a: RawAnalysis, bars: RawBar[], interval: number): { states: AuctionState[]; transitions: AuctionTransition[] } {
  const states: AuctionState[] = [];
  const transitions: AuctionTransition[] = [];
  const lastBarOfSession = (session: string) => {
    const ofSession = bars.filter((b) => b.session === session && epoch(b.available_at) <= epoch(a.analysis_timestamp));
    return ofSession.length ? epoch(ofSession[ofSession.length - 1]!.timestamp) : null;
  };
  const ts = a.auction_state.transitions;
  const latestSession = bars.findLast((b) => epoch(b.available_at) <= epoch(a.analysis_timestamp))?.session;
  ts.forEach((t, i) => {
    const [from, to] = t.description.split("→").map((x) => x.trim());
    const id = `state-${t.id}`;
    const start = epoch(t.timestamp);
    const next = ts[i + 1];
    const session = bars.find((b) => epoch(b.timestamp) === start)?.session;
    const sameSessionNext = next && bars.find((b) => epoch(b.timestamp) === epoch(next.timestamp))?.session === session;
    const end = sameSessionNext ? epoch(next!.timestamp) : session === latestSession ? null : session ? lastBarOfSession(session) : start;
    const closes = Object.entries(t.coordinates);
    states.push({
      id, kind: to ?? t.description,
      startTime: start, endTime: end,
      detectedAt: epoch(t.first_observable_at) - interval,
      priceLow: num(t.coordinates["prior_val"]) ?? undefined,
      priceHigh: num(t.coordinates["prior_vah"]) ?? undefined,
      summary: `${from ? humanize(from) : "?"} → ${to ? humanize(to) : "?"} (rule classification against the prior complete session's value area).`,
    });
    transitions.push({
      id: `tr-${t.id}`,
      fromStateId: i > 0 && bars.find((b) => epoch(b.timestamp) === epoch(ts[i - 1]!.timestamp))?.session === session ? states[i - 1]!.id : null,
      toStateId: id,
      at: start,
      detectedAt: epoch(t.first_observable_at) - interval,
      rationale: `${from ? humanize(from) : "?"} → ${to ? humanize(to) : "?"}. Classified from completed closes relative to the prior session's value area.`,
      evidence: [
        ...closes.map(([k, v], n) => ({ id: `${t.id}-c${n}`, kind: "structure" as const, nature: "observed" as const, text: `${humanize(k)}: ${readable(v)}` })),
        ...Object.entries(t.measurements).map(([k, v], n) => ({ id: `${t.id}-m${n}`, kind: "auction" as const, nature: "classified" as const, text: `${humanize(k)}: ${readable(v)}` })),
        ...t.supporting_evidence.map((sid, n) => ({ id: `${t.id}-s${n}`, kind: "profile" as const, text: `Reference: ${sid}` })),
      ],
    });
  });
  return { states, transitions };
}

/** Recorded session resets only. Snapshots saved before resets existed yield null; nothing is reconstructed. */
export function mapAuctionResets(a: RawAnalysis): AuctionReset[] | null {
  const resets = a.auction_state.session_resets;
  if (!resets) return null;
  return resets.map((r) => ({
    id: r.id, session: r.session, previousSession: r.previous_session,
    at: epoch(r.timestamp), observableAt: epoch(r.first_observable_at),
    previousState: r.previous_state, referenceUsable: r.reference_usable,
    referenceSession: r.reference_session, referenceUnavailableReason: r.reference_unavailable_reason ?? null,
    description: r.description,
  }));
}

// ------------------------------------------------------------------ interpretation

function evidenceIndex(a: RawAnalysis, concepts: Map<string, RawConcept>) {
  const idx = new Map<string, EvidenceItem>();
  for (const p of a.profile_analysis) {
    idx.set(p.id, { id: p.id, kind: "profile", nature: "classified", text: `Session ${p.session} profile (estimated): ${shapeLabel(p.volume.shape.classification)}, ${p.volume.shape.ambiguity} ambiguity.` });
  }
  const add = (e: RawEvidence, kind: EvidenceItem["kind"]) => {
    const m = e.measurements;
    const bits = [num(m["relative_volume"]) !== null && `rel. volume ${num(m["relative_volume"])!.toFixed(2)}×`, num(m["close_location"]) !== null && `close location ${num(m["close_location"])!.toFixed(2)}`].filter(Boolean).join(", ");
    idx.set(e.id, { id: e.id, kind, nature: e.kind, text: `${concepts.get(e.concept_id)?.name ?? humanize(e.concept_id)} (${e.status})${e.direction !== "neutral" ? `, context: ${e.direction}` : ""}`, measurement: bits || undefined, at: epoch(e.timestamp) });
  };
  a.vsa_observations.forEach((e) => add(e, "vsa"));
  a.price_action_observations.forEach((e) => add(e, "price_action"));
  a.auction_state.transitions.forEach((e) => add({ ...e, description: e.description }, "auction"));
  for (const t of a.auction_state.transitions) idx.set(t.id, { id: t.id, kind: "auction", nature: "classified", text: `Auction: ${t.description}`, at: epoch(t.timestamp) });
  return idx;
}

export function mapInterpretation(a: RawAnalysis, concepts: Map<string, RawConcept>, interval: number, bars: RawBar[]): Interpretation {
  const idx = evidenceIndex(a, concepts);
  const resolve = (ids: string[]): EvidenceItem[] =>
    [...new Set(ids)].map((id) => idx.get(id) ?? { id, kind: "unresolved" as const, text: `Evidence ID not found in this response: ${id}` });
  const last = a.profile_analysis[a.profile_analysis.length - 1];
  const sessionStart = last ? sessionExtremes(bars, last.session, epoch(a.analysis_timestamp)).first : null;
  const sessionVsa = a.vsa_observations.filter((o) => sessionStart !== null && epoch(o.timestamp) >= sessionStart);
  const scen = (s: RawAnalysis["interpretations"][number], isAlternative: boolean): Scenario => ({
    id: s.id, title: humanize(s.id), description: s.description, supportedBy: s.evidence_ids,
    challengedBy: [], // the backend does not say which evidence challenges a scenario
    knowledgeSlugs: [], confirmation: s.confirmation_conditions, invalidation: s.invalidation_conditions, isAlternative,
  });
  const scenarios = [...a.interpretations.map((s) => scen(s, false)), ...a.alternative_scenarios.map((s) => scen(s, true))];

  // "What to observe next": the backend's own confirmation/invalidation conditions, attached to the scenarios that own them.
  const byText = new Map<string, { text: string; strengthens: Set<string>; weakens: Set<string> }>();
  for (const s of scenarios) {
    for (const t of s.confirmation ?? []) (byText.get("c:" + t) ?? byText.set("c:" + t, { text: t, strengthens: new Set(), weakens: new Set() }).get("c:" + t)!).strengthens.add(s.id);
    for (const t of s.invalidation ?? []) (byText.get("i:" + t) ?? byText.set("i:" + t, { text: t, strengthens: new Set(), weakens: new Set() }).get("i:" + t)!).weakens.add(s.id);
  }
  const watchNext = [...byText.values()].map((w, n) => ({ id: `w${n + 1}`, text: w.text, strengthens: [...w.strengthens], weakens: [...w.weakens] }));

  const mc = a.market_context;
  // Prices are rounded for reading; the backend value is kept unrounded in the snapshot.
  const lastCloseText = typeof mc["last_close"] === "number" ? fmtPrice(mc["last_close"]) : (mc["last_close"] ?? "n/a");
  const sentenceEnd = a.plain_english_summary.split(/\.(?:\s|$)/)[0] ?? a.plain_english_summary;
  const uncertainty: Interpretation["uncertainty"] = a.uncertainties.map((text) => ({ kind: "other" as const, text }));
  if (a.profile_analysis.some((p) => p.tpo.estimated || p.volume.estimated)) {
    uncertainty.unshift({ kind: "estimated_profile", text: "Profiles are estimates: TPO uses range occupancy and volume is spread uniformly over each bar's touched price bins. This is not exact volume-at-price." });
  }
  if (a.data_quality.missing_bars || a.data_quality.incomplete_sessions.length) uncertainty.push({ kind: "missing_data", text: `Data gaps: ${a.data_quality.missing_bars} missing bar(s); incomplete sessions: ${a.data_quality.incomplete_sessions.join(", ") || "none"}.` });
  if (a.vsa_observations.some((o) => o.status === "provisional")) uncertainty.push({ kind: "provisional", text: "Some VSA candidates are provisional: later closes may confirm, invalidate or let them expire." });

  const volShape = last?.volume.shape;
  return {
    asOf: epoch(a.analysis_timestamp) - interval,
    whatIsHappening: { quick: sentenceEnd, standard: a.plain_english_summary, deep: [`Background: ${mc["background"] ?? "n/a"}; last close ${lastCloseText} (session ${mc["last_session"] ?? "n/a"}).`, `Engine ${a.engine_version}, knowledge ${a.knowledge_version}.`] },
    whyItMatters: null, // not authored by the backend
    context: { quick: `Background trend: ${mc["background"] ?? "n/a"}. Auction: ${humanize(a.auction_state.state)}.`, standard: `Measured background trend is “${mc["background"] ?? "n/a"}”. The auction classification is “${humanize(a.auction_state.state)}”, derived from closes relative to the prior complete session's value area.`, deep: a.auction_state.transitions.slice(-3).map((t) => `${t.timestamp}: ${t.description}`) },
    profile: volShape ? { quick: `${shapeLabel(volShape.classification)} (${volShape.ambiguity} ambiguity, estimated).`, standard: `${volShape.interpretation} Alternative classification(s): ${volShape.alternatives.map(humanize).join(", ") || "none"}. ${volShape.limitations[0] ?? ""}`, deep: [...Object.entries(volShape.features).map(([k, v]) => `${humanize(k)}: ${Number(v.toPrecision(4))}`), ...volShape.limitations] } : null,
    vsa: { quick: `${sessionVsa.length} VSA observation(s) in the latest session.`, standard: sessionVsa.length ? `Observations: ${[...new Set(sessionVsa.map((o) => concepts.get(o.concept_id)?.name ?? humanize(o.concept_id)))].join(", ")}.` : "No VSA observations in the latest session.", deep: sessionVsa.map((o) => `${o.timestamp} — ${o.concept_id} (${o.status}, ${o.direction})`) },
    priceAction: { quick: `${a.price_action_observations.length} price-action observation(s) in the analysed history.`, standard: `Latest close ${lastCloseText}. Observed concepts: ${[...new Set(a.price_action_observations.map((o) => o.concept_id))].map(humanize).join(", ") || "none"}.`, deep: a.price_action_observations.slice(-8).map((o) => `${o.timestamp} — ${o.concept_id}: ${o.description}`) },
    supporting: resolve(a.supporting_evidence),
    contradicting: resolve(a.contradicting_evidence),
    scenarios,
    watchNext,
    uncertainty,
    evidenceBalance: a.contradicting_evidence.length ? "mixed" : "consistent",
  };
}

// ------------------------------------------------------------------ levels

export function mapLevels(a: RawAnalysis): Level[] {
  const sessions = a.profile_analysis.filter((p) => p.scope === "session");
  const cur = sessions[sessions.length - 1];
  const prior = sessions[sessions.length - 2];
  const out: Level[] = [];
  if (prior) {
    const complete = !a.data_quality.incomplete_sessions.includes(prior.session);
    const note = `Session ${prior.session}${complete ? "" : " (incomplete session)"}; estimated profile.`;
    if (prior.volume.vah !== null) out.push({ id: "prior_vah", kind: "prior_vah", price: prior.volume.vah, label: "Prior VAH", note });
    if (prior.volume.val !== null) out.push({ id: "prior_val", kind: "prior_val", price: prior.volume.val, label: "Prior VAL", note });
    if (prior.volume.poc !== null) out.push({ id: "prior_poc", kind: "prior_poc", price: prior.volume.poc, label: "Prior POC", note });
  }
  const ib = cur?.initial_balance;
  if (ib && typeof ib["high"] === "number" && typeof ib["low"] === "number") {
    const note = ib["complete"] === false ? "Initial balance window not yet complete." : undefined;
    out.push({ id: "ib_high", kind: "ib_high", price: ib["high"], label: "IB high", note }, { id: "ib_low", kind: "ib_low", price: ib["low"], label: "IB low", note });
  }
  return out;
}

// ------------------------------------------------------------------ top level

export function mapAnalysis(a: RawAnalysis, ctx: { bars: RawBar[] }): Analysis {
  const storedKnowledge = a.knowledge_snapshot;
  const hasStoredKnowledge = storedKnowledge?.version === a.knowledge_version;
  const concepts = new Map(hasStoredKnowledge ? storedKnowledge!.concepts.map((c) => [c.id, c]) : []);
  const interval = intervalSec(a.provenance);
  const upTo = epoch(a.analysis_timestamp);
  const sessions = a.profile_analysis.filter((p) => p.scope === "session");
  const cur = sessions[sessions.length - 1];
  const prior = sessions[sessions.length - 2];
  const profiles: Analysis["profiles"] = {};
  const put = (key: string, p: Profile | null) => { if (p) profiles[key] = p; };
  if (cur) {
    put("tpo", mapProfile(cur, "tpo", ctx.bars, upTo, `TPO — session ${cur.session}`, concepts));
    put("volume", mapProfile(cur, "volume", ctx.bars, upTo, `Volume — session ${cur.session}`, concepts));
  }
  if (prior) put("prior", mapProfile(prior, "prior", ctx.bars, upTo, `Prior session ${prior.session}`, concepts));
  if (a.composite_profile) put("composite", mapProfile(a.composite_profile, "composite", ctx.bars, upTo, "Composite — all visible sessions", concepts));

  // Per-session value values (facts from each session's profile) – not a migration classification.
  const migration = sessions.slice(-8).filter((p) => p.volume.poc !== null && p.volume.vah !== null && p.volume.val !== null)
    .map((p) => ({ date: p.session, poc: p.volume.poc!, vah: p.volume.vah!, val: p.volume.val! }));
  for (const p of Object.values(profiles)) p.valueMigration = migration;

  const { states, transitions } = mapAuction(a, ctx.bars, interval);
  const lastBarStart = upTo - interval;
  if (!states.length || states[states.length - 1]!.endTime !== null || states[states.length - 1]!.kind !== a.auction_state.state) {
    for (const state of states) if (state.endTime === null) state.endTime = lastBarStart;
    states.push({
      id: "state-current", kind: a.auction_state.state, startTime: lastBarStart, endTime: null, detectedAt: lastBarStart,
      summary: `Current engine state: ${humanize(a.auction_state.state)}. No transition evidence is recorded for this state in the current session.`,
    });
  }

  const ref = prior?.volume;
  const lastClose = typeof a.market_context["last_close"] === "number" ? a.market_context["last_close"] : null;
  const interpretation = mapInterpretation(a, concepts, interval, ctx.bars);
  if (!hasStoredKnowledge) interpretation.uncertainty.push({ kind: "other", text: "This saved analysis has no matching preserved knowledge catalog. Generic concept explanations are unavailable; current catalog text has not been substituted." });
  return {
    symbol: a.instrument,
    datasetId: a.dataset_id,
    persisted: a.persisted,
    timeframe: a.timeframe,
    session: a.provenance.session_mode === "regular" ? "RTH" : "ETH",
    asOf: lastBarStart,
    generatedAt: a.created_at,
    source: mapSource(a.provenance),
    analysisTimeframe: a.timeframe,
    snapshot: a.persisted && a.id !== null ? { id: a.id, engineVersion: a.engine_version, knowledgeVersion: a.knowledge_version, createdAt: a.created_at, datasetId: a.dataset_id } : undefined,
    status: "ok",
    statusMessage: null,
    quality: mapQuality(a.data_quality, ctx.bars.filter((b) => epoch(b.available_at) <= upTo), a.profile_analysis.some((p) => p.volume.estimated || p.tpo.estimated)),
    profiles,
    // The backend does not classify price location; the UI shows the two raw numbers and says so.
    valueLocation: lastClose === null ? null : {
      price: lastClose,
      relativeTo: "unknown",
      referenceProfile: ref?.vah != null && ref?.val != null ? `Prior session ${prior!.session} value area ${ref.val}–${ref.vah} (estimated)` : "No prior session value area",
      distanceFromPocPct: null,
    },
    vsaEvents: a.vsa_observations.map((e) => mapVsaEvent(e, interval, concepts)),
    auctionStates: states,
    auctionTransitions: transitions,
    auctionResets: mapAuctionResets(a),
    levels: mapLevels(a),
    interpretation,
  };
}
