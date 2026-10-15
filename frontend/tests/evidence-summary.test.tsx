import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InterpretationSummary } from "@/components/interpretation/InterpretationPanel";
import { evidenceSummary } from "@/lib/evidenceSummary";
import type { Analysis } from "@/types";

afterEach(cleanup);

const make = (o: { loc?: "above_value" | "unavailable"; auction?: string; vsa?: ("strength" | "weakness")[]; status?: string } = {}): Analysis => ({
  status: o.status ?? "ok",
  valueLocation: o.loc ? { price: 101, relativeTo: "unknown", referenceProfile: "", distanceFromPocPct: null,
    context: { state: o.loc, price: 101, asOf: 1, referenceSession: "2025-03-07", val: 99, vah: 100, poc: 99.5, unavailableReason: o.loc === "unavailable" ? "no_prior_session" : null } } : null,
  auctionStates: o.auction ? [{ id: "s", kind: o.auction, startTime: 0, endTime: null, detectedAt: 0, summary: "" }] : [],
  auctionResets: null,
  vsaEvents: (o.vsa ?? []).map((d, i) => ({ id: `e${i}`, barTime: 10, direction: d, status: "provisional" })),
  interpretation: { evidenceBalance: "mixed", asOf: 1, whatIsHappening: { quick: "q", standard: "s", deep: [] }, whyItMatters: null, supporting: [], contradicting: [], watchNext: [], uncertainty: [], scenarios: [] },
} as unknown as Analysis);

describe("evidenceSummary", () => {
  it("restates supplied readings as facts", () => {
    const items = evidenceSummary(make({ loc: "above_value", auction: "higher_price_acceptance", vsa: ["strength", "weakness", "strength"] }))!;
    const by = Object.fromEntries(items.map((i) => [i.label, i.text]));
    expect(by["Price location"]).toContain("Above prior value: close 101.00 against prior value 99.00–100.00");
    expect(by["Auction state"]).toMatch(/higher price acceptance/i);
    expect(by["Active VSA signals"]).toBe("2 strength, 1 weakness this session");
    expect(by["Evidence balance"]).toBe("Mixed");
  });

  it("reports an unavailable location with its reason and hides on bad status", () => {
    expect(evidenceSummary(make({ loc: "unavailable" }))![0]!.text).toContain("there is no earlier session in the data");
    expect(evidenceSummary(make({ status: "insufficient_data" }))).toBeNull();
  });

  it("never states a direction, entry or failure level", () => {
    const text = JSON.stringify(evidenceSummary(make({ loc: "above_value", auction: "higher_price_acceptance", vsa: ["strength"] })));
    expect(text).not.toMatch(/lean|long|short|stand aside|fails on|entry|target/i);
  });
});

describe("InterpretationSummary depth", () => {
  const a = make({ loc: "above_value", auction: "higher_price_acceptance" });
  it("shows the evidence summary at Quick only and no trade idea anywhere", () => {
    const { rerender } = render(<InterpretationSummary analysis={a} level="quick" />);
    expect(screen.getByLabelText("Evidence summary")).toBeTruthy();
    expect(screen.queryByLabelText("Trade idea")).toBeNull();
    for (const level of ["standard", "deep"] as const) {
      rerender(<InterpretationSummary analysis={a} level={level} />);
      expect(screen.queryByLabelText("Evidence summary")).toBeNull();
    }
  });
});
