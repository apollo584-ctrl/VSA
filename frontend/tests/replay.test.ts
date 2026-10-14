import { describe, expect, it } from "vitest";
import { barTimeContaining, clipBars, knownEvents, knownStates } from "@/lib/replay";
import type { AuctionState, Bar, VsaEvent } from "@/types";

const bars: Bar[] = [0, 1800, 3600, 5400].map((t, i) => ({ t, o: 1, h: 2, l: 0.5, c: 1.5 + i, v: 10 }));

const event = (over: Partial<VsaEvent> = {}): VsaEvent => ({
  id: "e", type: "upthrust", barTime: 1800, detectedAt: 1800, status: "confirmed",
  statusHistory: [{ status: "provisional", at: 1800 }, { status: "confirmed", at: 5400, reason: "later" }],
  measurements: { spread: 1, spreadVsAvg: 1, relativeVolume: 1, closeLocation: 0.5, priorTrend: "up", priceLocation: "x" },
  conditions: [], implications: [], alternatives: [], confirmation: [], invalidation: [], profileRefs: [], referencePrices: [], knowledgeSlugs: [], ...over,
});

describe("replay no-look-ahead guards", () => {
  it("clips bars after the cursor", () => {
    expect(clipBars(bars, 3600).map((b) => b.t)).toEqual([0, 1800, 3600]);
    expect(clipBars(bars, null)).toBe(bars);
  });

  it("drops events detected after the cursor", () => {
    expect(knownEvents([event({ detectedAt: 5400 })], 3600)).toHaveLength(0);
  });

  it("rolls back statuses assigned after the cursor", () => {
    const [e] = knownEvents([event()], 3600);
    expect(e!.status).toBe("provisional");
    expect(e!.statusHistory).toHaveLength(1);
  });

  it("keeps later confirmations once they are knowable", () => {
    const [e] = knownEvents([event()], 5400);
    expect(e!.status).toBe("confirmed");
  });

  it("reopens states whose end lies in the future", () => {
    const s: AuctionState = { id: "s", kind: "balance", startTime: 0, endTime: 5400, detectedAt: 0, summary: "" };
    expect(knownStates([s], 1800)[0]!.endTime).toBeNull();
    expect(knownStates([s], 5400)[0]!.endTime).toBe(5400);
  });

  it("maps a finer timestamp onto the containing bar", () => {
    expect(barTimeContaining(bars, 2500)).toBe(1800);
    expect(barTimeContaining(bars, -5)).toBeNull();
  });
});
