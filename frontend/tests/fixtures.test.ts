import { describe, expect, it } from "vitest";
import { indexAtOrBefore, mockApi } from "@/fixtures/api";
import { analysisSchema, barsResponseSchema, instrumentListSchema, knowledgeListSchema } from "@/lib/api/schemas";

describe("mock fixtures match the API schemas", () => {
  it("instruments", async () => {
    const instruments = await mockApi.listInstruments();
    expect(instrumentListSchema.safeParse({ instruments }).success).toBe(true);
  });

  it("bars (30m and 1D)", async () => {
    for (const timeframe of ["30m", "1D"]) {
      const r = await mockApi.getBars({ symbol: "FIXA", timeframe, session: "RTH" });
      expect(barsResponseSchema.safeParse(r).success).toBe(true);
      expect(r.bars.length).toBeGreaterThan(0);
    }
  });

  it("analysis for every fixture instrument", async () => {
    for (const symbol of ["FIXA", "FIXB", "FIXC"]) {
      const a = await mockApi.getAnalysis({ symbol, timeframe: "30m", session: "RTH" });
      expect(analysisSchema.safeParse(a).success, symbol).toBe(true);
    }
  });

  it("knowledge links resolve", async () => {
    const concepts = await mockApi.listKnowledge();
    expect(knowledgeListSchema.safeParse({ concepts }).success).toBe(true);
    const slugs = new Set(concepts.map((c) => c.slug));
    for (const c of concepts) for (const r of c.related) expect(slugs.has(r.slug), `${c.slug} -> ${r.slug}`).toBe(true);
  });
});

describe("fixture behaviour", () => {
  it("FIXA ends with a provisional upthrust and a P-shaped estimated profile", async () => {
    const a = await mockApi.getAnalysis({ symbol: "FIXA", timeframe: "30m", session: "RTH" });
    const ut = a.vsaEvents.find((e) => e.type === "upthrust");
    expect(ut?.status).toBe("provisional");
    expect(a.profiles.volume?.shape.type).toBe("P");
    expect(a.profiles.volume?.estimated).toBe(true);
    expect(a.valueLocation?.relativeTo).toBe("above_value");
  });

  it("does not leak future events when asked as of an earlier time", async () => {
    const full = await mockApi.getAnalysis({ symbol: "FIXA", timeframe: "30m", session: "RTH" });
    const ut = full.vsaEvents.find((e) => e.type === "upthrust")!;
    const earlier = await mockApi.getAnalysis({ symbol: "FIXA", timeframe: "30m", session: "RTH", asOf: ut.barTime - 1800 });
    expect(earlier.vsaEvents.some((e) => e.type === "upthrust")).toBe(false);
    for (const e of earlier.vsaEvents) expect(e.detectedAt).toBeLessThanOrEqual(earlier.asOf);
    for (const s of earlier.auctionStates) expect(s.detectedAt).toBeLessThanOrEqual(earlier.asOf);
  });

  it("FIXB has no patterns and FIXC is insufficient", async () => {
    expect((await mockApi.getAnalysis({ symbol: "FIXB", timeframe: "30m", session: "RTH" })).vsaEvents).toHaveLength(0);
    const c = await mockApi.getAnalysis({ symbol: "FIXC", timeframe: "30m", session: "RTH" });
    expect(c.status).toBe("insufficient_data");
    expect(c.interpretation).toBeNull();
  });

  it("indexAtOrBefore", () => {
    expect(indexAtOrBefore([10, 20, 30], 25)).toBe(1);
    expect(indexAtOrBefore([10, 20, 30], 5)).toBe(-1);
  });
});
