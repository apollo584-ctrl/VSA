import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanBoard } from "@/components/scan/ScanBoard";
import type { RawScan } from "@/lib/api/backend/schemas";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/workspace", () => ({ useWorkspace: () => ({ selectInstrument: vi.fn() }) }));

const snapshot: RawScan = {
  status: { running: false, finished_at: "2025-03-10T15:00:00Z", total: 3, done: 3, auto_minutes: 30, universe_size: 503 },
  results: [
    { symbol: "AAA", name: "AAA Inc", sector: "Tech", status: "ok", direction: "strength", agreeing: 3, last_close: 101.5, last_bar_at: "2025-03-10T14:30:00Z", scanned_at: "2025-03-10T15:00:00Z",
      votes: [{ factor: "value_location", vote: 1, text: "Close above prior value" }, { factor: "auction_state", vote: 1, text: "Auction state: higher price acceptance" }, { factor: "vsa", vote: 1, text: "Active VSA this session: 2 strength, 0 weakness" }, { factor: "price_action", vote: 0, text: "x" }] },
    { symbol: "BBB", name: "BBB Inc", sector: "Energy", status: "ok", direction: "weakness", agreeing: 4, last_close: 50, scanned_at: "2025-03-10T15:00:00Z", votes: [{ factor: "vsa", vote: -1, text: "Active VSA this session: 0 strength, 2 weakness" }] },
    { symbol: "CCC", name: "CCC Inc", sector: "Tech", status: "error", direction: "none", agreeing: 0, votes: [], scanned_at: "2025-03-10T15:00:00Z", error: "boom" },
  ],
};

vi.mock("@/lib/api/client", () => ({ api: { getScan: () => Promise.resolve(snapshot), runScan: vi.fn(), setScanAuto: vi.fn(), loadSymbol: vi.fn() } }));

afterEach(cleanup);
const wrap = () => render(<QueryClientProvider client={new QueryClient()}><ScanBoard /></QueryClientProvider>);

describe("ScanBoard", () => {
  it("lists only flagged symbols with the reasons behind each flag", async () => {
    wrap();
    expect(await screen.findByText("AAA")).toBeTruthy();
    expect(screen.getByText("BBB")).toBeTruthy();
    expect(screen.queryByText("CCC")).toBeNull();
    expect(screen.getByText(/Strength · 3 of 4/)).toBeTruthy();
    expect(screen.getByText(/Auction state: higher price acceptance/)).toBeTruthy();
    expect(screen.queryByText("x")).toBeNull(); // neutral readings are not listed as reasons
    expect(screen.getByText(/2 flagged of 2 analysed · 1 could not be loaded/)).toBeTruthy();
  });

  it("filters by direction", async () => {
    wrap();
    await screen.findByText("AAA");
    screen.getByRole("radio", { name: "Weakness" }).click();
    expect(await screen.findByText("BBB")).toBeTruthy();
    expect(screen.queryByText("AAA")).toBeNull();
  });
});
