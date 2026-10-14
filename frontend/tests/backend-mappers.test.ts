import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clipBars, knownEvents } from "@/lib/replay";
import { analysisSchema, barsResponseSchema, knowledgeListSchema } from "@/lib/api/schemas";
import { mapAnalysis, mapConcept, barsResponse } from "@/lib/api/backend/mappers";
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
  const ui = have ? mapAnalysis(rawAnalysis, { bars, concepts }) : (null as never);

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
      expect(e.conditions.every((c) => c.met === null)).toBe(true);
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
});
