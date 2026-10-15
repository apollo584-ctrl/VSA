import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionResets } from "@/components/auction/AuctionPanels";
import type { AuctionReset } from "@/types";

afterEach(cleanup);

const reset = (over: Partial<AuctionReset> = {}): AuctionReset => ({
  id: "auction_reset:2025-03-10", session: "2025-03-10", previousSession: "2025-03-07",
  at: Date.parse("2025-03-10T13:30:00Z") / 1000, observableAt: Date.parse("2025-03-10T13:35:00Z") / 1000,
  previousState: "higher_price_acceptance", referenceUsable: true, referenceSession: "2025-03-07",
  referenceUnavailableReason: null, description: "", ...over,
});

describe("SessionResets", () => {
  it("says a legacy snapshot recorded none and infers nothing", () => {
    render(<SessionResets resets={null} />);
    expect(screen.getByText(/did not record session resets\. None are inferred/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("distinguishes an empty recorded list from a missing one", () => {
    render(<SessionResets resets={[]} />);
    expect(screen.getByText(/No session boundary occurs/)).toBeTruthy();
  });

  it("shows the recorded first-bar and observable times, previous state and reference", () => {
    render(<SessionResets resets={[reset()]} />);
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("Session reset");
    expect(item.textContent).toContain("first bar Mar 10, 09:30 ET");
    expect(item.textContent).toContain("observable Mar 10, 09:35 ET");
    expect(item.textContent).toMatch(/restarted from .*acceptance.* \(session 2025-03-07\)/i);
    expect(item.textContent).toContain("Reference: prior session 2025-03-07 value area.");
  });

  it("explains an unusable prior value", () => {
    render(<SessionResets resets={[reset({ referenceUsable: false, referenceSession: null, referenceUnavailableReason: "prior_session_incomplete" })]} />);
    expect(screen.getByRole("listitem").textContent).toContain("No usable prior value: the prior session was incomplete.");
  });
});
