import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutcomesBoard } from "@/components/outcomes/OutcomesBoard";
import { rawOutcomesSchema } from "@/lib/api/backend/schemas";

const idle = { running: false, total: 0, done: 0, errors: 0 };
const stat = (concept: string, period: "older" | "newer", extra = {}) => ({
  concept, direction: "strength", horizon: 5, period, n_cases: 50, hit_rate: 0.6, baseline_hit_rate: 0.5, edge: 0.1, holds: true, ...extra,
});
const base = {
  generated_at: "2026-10-01T00:00:00Z", symbols_used: ["AAA"], date_range: { start: "2016-01-01", end: "2026-01-01" }, cutoff_date: "2023-01-01",
  horizons: [1, 5, 20], min_cases: 30, holds: [],
};
let payload: unknown;
vi.mock("@/lib/api/client", () => ({
  api: {
    getOutcomes: () => Promise.resolve(rawOutcomesSchema.parse(payload)), runOutcomes: vi.fn(),
    getIntraday: () => Promise.resolve({ status: idle, summary: { symbols: 0, bars: 0, rebased_symbols: 0 } }), collectIntraday: vi.fn(),
  },
}));

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><OutcomesBoard /></QueryClientProvider>);
}
afterEach(cleanup);

describe("OutcomesBoard", () => {
  it("renders an old study (no concepts, breakdowns or extra stats) as before", async () => {
    payload = { status: idle, study: { ...base, stats: [stat("stopping_volume", "older"), stat("stopping_volume", "newer")] } };
    show();
    expect(await screen.findByText("Stopping volume")).toBeTruthy();
    expect(screen.getByText("VSA signals")).toBeTruthy();
    expect(screen.queryByText("Where it works")).toBeNull();
    expect(screen.queryByText(/t-stat \d/)).toBeNull();
    expect(screen.getByText(/t-stat measures how far/)).toBeTruthy();
    expect(screen.getByText(/costs and slippage can erase them/)).toBeTruthy();
  });

  it("groups new patterns with labels, descriptions, extra stats and a breakdown view", async () => {
    payload = {
      status: idle,
      study: {
        ...base,
        stats: [stat("stopping_volume", "newer"), stat("gap_up", "newer", { t_stat: 2.5, win_loss_ratio: 1.4 }), stat("rsi2_oversold", "newer")],
        concepts: {
          gap_up: { direction: "strength", group: "price", label: "Gap up", description: "Opened 1% above." },
          rsi2_oversold: { direction: "strength", group: "momentum", label: "2-day RSI below 10", description: "Oversold." },
        },
        breakdowns: [{ concept: "gap_up", horizon: 5, dimension: "trend", value: "up", n_cases: 20, hit_rate: 0.7, edge: 0.2 }],
      },
    };
    show();
    const price = await screen.findByRole("region", { name: "Price patterns" });
    expect(within(price).getByText("Gap up")).toBeTruthy();
    expect(within(price).getByText("Opened 1% above.")).toBeTruthy();
    expect(within(price).getByText(/t-stat 2\.5/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Momentum" })).getByText("2-day RSI below 10")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "VSA signals" })).getByText("Stopping volume")).toBeTruthy();
    fireEvent.click(screen.getByText("Where it works"));
    expect(within(screen.getByRole("region", { name: "Price patterns" })).getByText("70%")).toBeTruthy();
  });
});
