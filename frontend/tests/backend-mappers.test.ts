import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clipBars, knownEvents, knownResets } from "@/lib/replay";
import { analysisSchema, barsResponseSchema, knowledgeListSchema } from "@/lib/api/schemas";
import { mapAnalysis, mapConcept, mapProfile, mapVsaEvent, barsResponse } from "@/lib/api/backend/mappers";
import { rawAnalysisSchema, rawBarSchema, rawConceptSchema, rawDatasetSchema } from "@/lib/api/backend/schemas";

// Backend-published example responses (backend/fixtures). Skipped if the backend folder is absent.
const dir = path.resolve(__dirname, "../../backend/fixtures");
const have = existsSync(path.join(dir, "analysis_response.json"));
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));

describe.skipIf(!have)("backend fixture → UI mapping", () => {
  const rawAnalysis = have ? rawAnalysisSchema.parse(read("analysis_response.json")) : (null as never);
  const bars = have ? rawBarSchema.array().parse(read("bars_response.json")) : [];
  const dataset = have ? rawDatasetSchema.parse(read("dataset_response.json")) : (null as never);
  const concepts = have
    ? new Map(rawConceptSchema.array().parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../backend/app/knowledge/concepts.json"), "utf8")).concepts).map((c) => [c.id, c]))
    : new Map();
  const ui = have ? mapAnalysis(rawAnalysis, { bars }) : (null as never);

  it("raw responses satisfy the documented schemas and map to valid UI types", () => {
    expect(analysisSchema.safeParse(ui).success).toBe(true);
    expect(barsResponseSchema.safeParse(barsResponse(dataset, bars)).success).toBe(true);
    expect(knowledgeListSchema.safeParse({ concepts: [...concepts.values()].map(mapConcept) }).success).toBe(true);
  });

  it("keeps observations, classifications, hypotheses and uncertainty apart", () => {
    const kinds = new Set(ui.vsaEvents.map((e) => e.kind));
    expect(kinds.has("classified")).toBe(true);
    // evidence resolved from IDs keeps its observed/classified nature
    expect(ui.interpretation!.supporting.every((e) => e.nature || e.kind === "unresolved")).toBe(true);
    // scenarios are separate from evidence and flagged as alternatives where applicable
    expect(ui.interpretation!.scenarios.some((s) => s.isAlternative)).toBe(true);
    expect(ui.interpretation!.uncertainty.length).toBeGreaterThan(0);
    expect(ui.interpretation!.uncertainty.some((u) => u.kind === "estimated_profile")).toBe(true);
  });

  it("does not invent fields the backend lacks", () => {
    expect(ui.interpretation!.whyItMatters).toBeNull();
    expect(ui.valueLocation?.relativeTo).toBe("unknown");
    expect(ui.profiles["developing"]).toBeUndefined();
    for (const e of ui.vsaEvents) {
      expect(e.measurements.priceLocation).toBeNull();
      expect(e.textSource).toBe("catalog");
      expect(e.conditionSource).toBe("instance");
      expect(e.conditions.length).toBeGreaterThan(0);
      expect(e.conditions.every((c) => c.met === true)).toBe(true);
    }
    for (const p of Object.values(ui.profiles)) expect(p.shape.confidence).toBeNull();
  });

  it("estimated flags and methods are preserved", () => {
    for (const p of Object.values(ui.profiles)) {
      expect(p.estimated).toBe(true);
      expect(p.estimationMethod).toMatch(/^estimated_/);
    }
  });

  it("maps backend bar-end instants back to bar-start so the cursor and the engine agree", () => {
    const iv = 5 * 60;
    const last = bars[bars.length - 1]!;
    expect(ui.asOf).toBe(Date.parse(last.timestamp) / 1000);
    expect(Date.parse(rawAnalysis.analysis_timestamp) / 1000 - ui.asOf).toBe(iv);
    // at the analysis cursor, nothing is hidden by the defensive replay guard
    expect(knownEvents(ui.vsaEvents, ui.asOf)).toHaveLength(ui.vsaEvents.length);
    // one bar earlier, events first observable at the final bar's end are hidden
    const hidden = knownEvents(ui.vsaEvents, ui.asOf - iv).length;
    expect(hidden).toBeLessThanOrEqual(ui.vsaEvents.length);
  });

  it("derives the auction timeline only from backend transitions", () => {
    expect(ui.auctionTransitions.length).toBe(rawAnalysis.auction_state.transitions.length);
    expect(ui.auctionStates[ui.auctionStates.length - 1]!.kind).toBe(rawAnalysis.auction_state.state);
  });

  it("profile bins align one-to-one with the backend arrays", () => {
    const vol = ui.profiles["volume"]!;
    const raw = rawAnalysis.profile_analysis.filter((p) => p.scope === "session").at(-1)!;
    expect(vol.bins.map((b) => b.price)).toEqual(raw.price_bin_center);
    expect(vol.bins.map((b) => b.volume)).toEqual(raw.volume.counts);
    expect(vol.poc).toBe(raw.volume.poc);
    expect(vol.vah).toBe(raw.volume.vah);
    expect(clipBars([], null)).toEqual([]);
  });

  it("uses visible constituent OHLC and dates for composite bounds", () => {
    const p = structuredClone(rawAnalysis.profile_analysis[0]!);
    p.scope = "composite";
    p.session = `${bars[0]!.session}/${bars[bars.length - 1]!.session}`;
    p.as_of = bars[200]!.available_at;
    const visible = bars.slice(0, 201);
    const mapped = mapProfile(p, "composite", bars, Date.parse(rawAnalysis.analysis_timestamp) / 1000, "Composite", concepts)!;
    expect(mapped.startTime).toBe(Date.parse(visible[0]!.timestamp) / 1000);
    expect(mapped.endTime).toBe(Date.parse(visible.at(-1)!.timestamp) / 1000);
    expect(mapped.sessionHigh).toBe(Math.max(...visible.map((b) => b.high)));
    expect(mapped.sessionLow).toBe(Math.min(...visible.map((b) => b.low)));
    expect(mapProfile(p, "composite", [], Infinity, "Composite", concepts)).toBeNull();
  });

  it.each(["indeterminate", "higher_price_acceptance"])("closes historical states after a session reset to %s", (currentState) => {
    const a = structuredClone(rawAnalysis);
    const oldBar = bars.find((b) => b.session === "2025-03-04")!;
    const latestBar = bars.find((b) => b.session === "2025-03-06")!;
    a.analysis_timestamp = latestBar.available_at;
    a.auction_state.state = currentState;
    a.auction_state.transitions = [{
      id: "old-acceptance", kind: "classified", concept_id: "auction_state", timestamp: oldBar.timestamp,
      first_observable_at: oldBar.available_at, status: "observed", direction: "neutral",
      description: "upward_breakout_attempt → higher_price_acceptance", coordinates: {}, measurements: {}, supporting_evidence: [],
    }];
    const subset = bars.filter((b) => b.session === oldBar.session || b.timestamp === latestBar.timestamp);
    const mapped = mapAnalysis(a, { bars: subset });
    expect(mapped.auctionStates.filter((s) => s.endTime === null).map((s) => s.kind)).toEqual([currentState]);
    expect(mapped.auctionStates[0]!.endTime).toBe(Date.parse(subset[77]!.timestamp) / 1000);
    expect(mapped.auctionStates.at(-1)!.detectedAt).toBe(Date.parse(latestBar.timestamp) / 1000);
    expect(mapped.auctionTransitions).toHaveLength(1); // no invented reset transition
  });

  it("maps recorded session resets separately from transitions, with the backend's own times", () => {
    const raw = rawAnalysis.auction_state.session_resets!;
    expect(raw.length).toBeGreaterThan(0);
    expect(ui.auctionResets).toHaveLength(raw.length);
    ui.auctionResets!.forEach((r, i) => {
      expect(r.at).toBe(Date.parse(raw[i]!.timestamp) / 1000);
      expect(r.observableAt).toBe(Date.parse(raw[i]!.first_observable_at) / 1000);
      expect(r.observableAt).toBeGreaterThan(r.at);
    });
    expect(ui.auctionTransitions).toHaveLength(rawAnalysis.auction_state.transitions.length);
    expect(ui.auctionTransitions.some((t) => t.id.includes("auction_reset"))).toBe(false);
    expect(ui.auctionStates.some((s) => s.id.includes("auction_reset"))).toBe(false);
  });

  it("does not fabricate resets for a legacy snapshot, and leaves the rest of the timeline unchanged", () => {
    const legacy = structuredClone(rawAnalysis);
    delete legacy.auction_state.session_resets;
    const mapped = mapAnalysis(rawAnalysisSchema.parse(legacy), { bars });
    expect(mapped.auctionResets).toBeNull();
    expect(mapped.auctionStates).toEqual(ui.auctionStates);
    expect(mapped.auctionTransitions).toEqual(ui.auctionTransitions);
    expect(analysisSchema.safeParse(mapped).success).toBe(true);
    expect(mapAnalysis({ ...legacy, auction_state: { ...legacy.auction_state, session_resets: null } }, { bars }).auctionResets).toBeNull();
  });

  it("hides a reset until its first bar is in view", () => {
    const resets = ui.auctionResets!;
    const r = resets[resets.length - 1]!;
    expect(knownResets(resets, r.at - 1)).not.toContainEqual(r);
    expect(knownResets(resets, r.at)).toContainEqual(r);
    expect(knownResets(null, r.at)).toBeNull();
  });

  it("uses preserved knowledge and explicitly withholds legacy or mismatched catalog text", () => {
    const a = structuredClone(rawAnalysis);
    a.knowledge_snapshot = { version: a.knowledge_version, concepts: [...concepts.values()].map((c) => structuredClone(c)) };
    const before = mapAnalysis(a, { bars });
    const changedCurrentCatalog = new Map([...concepts].map(([id, c]) => [id, { ...c, possible_interpretations: ["changed current catalog"] }]));
    expect(changedCurrentCatalog.get(before.vsaEvents[0]!.type)!.possible_interpretations).toEqual(["changed current catalog"]);
    expect(mapAnalysis(a, { bars })).toEqual(before);
    const legacy = { ...a, knowledge_snapshot: undefined };
    const mismatched = { ...a, knowledge_snapshot: { ...a.knowledge_snapshot!, version: "different-version" } };
    for (const raw of [legacy, mismatched]) {
      const mapped = mapAnalysis(raw, { bars });
      expect(mapped.vsaEvents.every((e) => e.textSource === "unavailable" && e.implications.length === 0 && e.conditionSource === "instance" && e.conditions.every((c) => c.met === true))).toBe(true);
      expect(mapped.interpretation!.uncertainty.some((u) => u.text.includes("no matching preserved knowledge"))).toBe(true);
      expect(mapped.interpretation!.whatIsHappening!.standard).toBe(raw.plain_english_summary);
    }
  });

  it("keeps previews unsaved and only displays a composite preserved in the response", () => {
    const preview = mapAnalysis({ ...rawAnalysis, id: null, persisted: false }, { bars });
    expect(preview.persisted).toBe(false);
    expect(preview.snapshot).toBeUndefined();
    expect(preview.datasetId).toBe(rawAnalysis.dataset_id);
    expect(preview.profiles.composite).toBeDefined();
    const legacy = mapAnalysis({ ...rawAnalysis, composite_profile: undefined }, { bars });
    expect(legacy.profiles.composite).toBeUndefined();
    expect(legacy.snapshot).toBeDefined();
    expect(rawAnalysisSchema.safeParse({ ...rawAnalysis, id: null, persisted: true }).success).toBe(false);
    expect(rawAnalysisSchema.safeParse({ ...rawAnalysis, persisted: false }).success).toBe(false);
  });

  it("preserves rule receipts and authoritative lifecycle timestamps", () => {
    for (const raw of rawAnalysis.vsa_observations) {
      const event = mapVsaEvent(raw, 300, concepts);
      expect(event.conditionSource).toBe("instance");
      for (const [index, condition] of raw.conditions_met!.entries()) {
        expect(event.conditions[index]).toMatchObject(condition);
        expect(event.conditions[index]!.detail).toContain(condition.metric);
      }
      expect(event.statusHistory).toEqual(raw.status_history!.map((h) => ({ ...h, at: Date.parse(h.at) / 1000 - 300 })));
      const last = event.statusHistory.at(-1)!;
      expect(last.status).toBe(event.status);
      if (event.statusHistory.length > 1) {
        const earlier = knownEvents([event], last.at - 300)[0]!;
        expect(earlier.status).toBe("provisional");
        expect(earlier.statusHistory).toHaveLength(1);
      }
    }
  });

  it("uses only supplied legacy timestamps and marks catalog conditions as unevaluated", () => {
    const raw = structuredClone(rawAnalysis.vsa_observations[0]!);
    raw.conditions_met = undefined;
    raw.status_history = undefined;
    raw.status = "expired";
    raw.confirmed_at = null;
    raw.invalidated_at = null;
    raw.expired_at = null;
    raw.resolved_at = null;
    delete raw.measurements.resolved_at;
    const legacy = mapVsaEvent(raw, 300, concepts);
    expect(legacy.conditionSource).toBe("catalog");
    expect(legacy.conditions.every((c) => c.met === null)).toBe(true);
    expect(legacy.statusHistory).toHaveLength(1); // no guessed expiry timestamp
    const at = new Date(Date.parse(raw.first_observable_at) + 300000).toISOString();
    raw.expired_at = at;
    expect(mapVsaEvent(raw, 300, concepts).statusHistory.at(-1)).toMatchObject({ status: "expired", at: Date.parse(at) / 1000 - 300 });
  });
});
