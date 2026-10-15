import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InterpretationSummary } from "@/components/interpretation/InterpretationPanel";
import { tradeIdea } from "@/lib/tradeIdea";
import type { Analysis } from "@/types";

afterEach(cleanup);

type Loc = "above_value" | "inside_value" | "below_value" | "unavailable";
const make = (o: { loc?: Loc; auction?: string; vsa?: ("strength" | "weakness")[]; balance?: string; status?: string } = {}): Analysis => ({
  status: o.status ?? "ok",
  valueLocation: o.loc ? { price: 101, relativeTo: "unknown", referenceProfile: "", distanceFromPocPct: null,
    context: { state: o.loc, price: 101, asOf: 1, referenceSession: "2025-03-07", val: o.loc === "unavailable" ? null : 99, vah: o.loc === "unavailable" ? null : 100, poc: 99.5, unavailableReason: o.loc === "unavailable" ? "no_prior_session" : null } } : null,
  auctionStates: o.auction ? [{ id: "s", kind: o.auction, startTime: 0, endTime: null, detectedAt: 0, summary: "" }] : [],
  auctionResets: null,
  vsaEvents: (o.vsa ?? []).map((d, i) => ({ id: `e${i}`, barTime: 10, direction: d, status: "provisional" })),
  interpretation: { evidenceBalance: o.balance ?? "consistent", asOf: 1, whatIsHappening: { quick: "q", standard: "s", deep: [] }, whyItMatters: null, supporting: [], contradicting: [], watchNext: [], uncertainty: [], scenarios: [] },
} as unknown as Analysis);

describe("tradeIdea", () => {
  it("leans long when two signals agree and none disagree, with the failure level", () => {
    const idea = tradeIdea(make({ loc: "above_value", auction: "higher_price_acceptance" }))!;
    expect(idea.action).toBe("long");
    expect(idea.invalidation).toContain("below 100.00");
    expect(idea.reasons.length).toBe(2);
  });

  it("leans short mirror-image, and uses VAL when already below value", () => {
    const idea = tradeIdea(make({ loc: "below_value", auction: "lower_price_acceptance", vsa: ["weakness"] }))!;
    expect(idea.action).toBe("short");
    expect(idea.invalidation).toContain("above 99.00");
  });

  it("uses the opposite value edge for a rejection back inside value", () => {
    expect(tradeIdea(make({ loc: "above_value", auction: "rejection_above_value", vsa: ["weakness"] }))!.action).toBe("stand_aside");
    const idea = tradeIdea(make({ loc: "inside_value", auction: "rejection_below_value", vsa: ["strength"] }))!;
    expect(idea.action).toBe("long");
    expect(idea.invalidation).toContain("below 99.00");
  });

  it("stands aside when signals conflict, only one agrees, or the engine reports mixed evidence", () => {
    expect(tradeIdea(make({ loc: "above_value", auction: "higher_price_acceptance", vsa: ["weakness"] }))!.action).toBe("stand_aside");
    expect(tradeIdea(make({ loc: "above_value", auction: "balance" }))!.action).toBe("stand_aside");
    expect(tradeIdea(make({ loc: "above_value", auction: "higher_price_acceptance", balance: "mixed" }))!.action).toBe("stand_aside");
  });

  it("does not count resolved VSA signals", () => {
    const a = make({ loc: "above_value", vsa: ["strength"] });
    a.vsaEvents[0]!.status = "invalidated";
    expect(tradeIdea(a)!.action).toBe("stand_aside");
  });

  it("reports insufficient information and never fabricates from missing location", () => {
    expect(tradeIdea(make({ loc: "unavailable" }))!.action).toBe("insufficient");
    expect(tradeIdea(make())!.action).toBe("insufficient");
    expect(tradeIdea(make({ status: "insufficient_data" }))).toBeNull();
  });
});

describe("InterpretationSummary depth", () => {
  const a = make({ loc: "above_value", auction: "higher_price_acceptance" });

  it("shows the trade idea at Quick only", () => {
    const { rerender } = render(<InterpretationSummary analysis={a} level="quick" />);
    expect(screen.getByText("Lean long")).toBeTruthy();
    expect(screen.getByText(/not a prediction or advice/)).toBeTruthy();
    for (const level of ["standard", "deep"] as const) {
      rerender(<InterpretationSummary analysis={a} level={level} />);
      expect(screen.queryByText("Lean long")).toBeNull();
      expect(screen.queryByLabelText("Trade idea")).toBeNull();
    }
  });
});
