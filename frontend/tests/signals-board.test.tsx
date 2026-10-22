import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignalsBoard } from "@/components/signals/SignalsBoard";
import type { RawAlerts, RawTrackRecord } from "@/lib/api/backend/schemas";

const push = vi.fn();
const selectInstrument = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/workspace", () => ({ useWorkspace: () => ({ selectInstrument }) }));

let alerts: RawAlerts;
let outcomesPayload: unknown = { status: { running: false, total: 0, done: 0, errors: 0 }, study: null };
const record: RawTrackRecord = {
  round_trip_cost: 0.001, min_cases: 30,
  rows: [
    { concept: "no_demand", direction: "weakness", horizon: 5, n: 4, hit_rate: 0.75, mean_return: 0.012, mean_return_net: 0.011, baseline_hit_rate: 0.5, verdict: "too few cases yet" },
    { concept: "stopping_volume", direction: "strength", horizon: 1, n: 40, hit_rate: 0.6, mean_return: 0.004, mean_return_net: 0.003, baseline_hit_rate: 0.52, verdict: "enough cases" },
  ],
};
const loadSymbol = vi.fn((_s: string) => Promise.resolve({ datasetId: "ds-aaa" }));
vi.mock("@/lib/api/client", () => ({
  api: {
    getAlerts: () => Promise.resolve(alerts), getAlertStatus: () => Promise.resolve({ running: false, total: 0, done: 0, errors: 0 }),
    runAlerts: vi.fn(), getOutcomes: () => Promise.resolve(outcomesPayload), getTrackRecord: () => Promise.resolve(record), loadSymbol: (s: string) => loadSymbol(s),
  },
}));

beforeEach(() => {
  push.mockClear(); selectInstrument.mockClear(); loadSymbol.mockClear();
  alerts = {
    session: "2025-03-10", last_run: { at: "2025-03-10T21:30:00Z", session: "2025-03-10", added: 1, scored: 0 },
    alerts: [{ symbol: "AAA", session_date: "2025-03-10", concept: "stopping_volume", direction: "strength", holding_horizons: [1, 5], study_newer: [{ horizon: 1, edge: 0.05, hit_rate: 0.58 }, { horizon: 5, edge: 0.03, hit_rate: 0.56 }] }],
  };
});
afterEach(cleanup);
const wrap = () => render(<QueryClientProvider client={new QueryClient()}><SignalsBoard /></QueryClientProvider>);

describe("SignalsBoard", () => {
  it("shows today's alerts with setup name and study edge per horizon", async () => {
    wrap();
    expect(await screen.findByText("AAA")).toBeTruthy();
    expect(screen.getByText("Stopping volume")).toBeTruthy();
    expect(screen.getByText(/1d: hit 58% · edge \+5\.0 pts/)).toBeTruthy();
    expect(screen.getByText(/5d: hit 56% · edge \+3\.0 pts/)).toBeTruthy();
  });

  it("uses the study's labels for alerts and track record, falling back to id text for others", async () => {
    outcomesPayload = {
      status: { running: false, total: 0, done: 0, errors: 0 },
      study: {
        generated_at: "2026-10-01T00:00:00Z", symbols_used: [], date_range: { start: "2016-01-01", end: "2026-01-01" }, cutoff_date: "2023-01-01",
        horizons: [1], min_cases: 30, holds: [], stats: [],
        concepts: { rsi2_oversold: { direction: "strength", group: "momentum", label: "2-day RSI below 10", description: "x" } },
      },
    };
    alerts.alerts = [
      { ...alerts.alerts[0]!, concept: "rsi2_oversold" },
      { ...alerts.alerts[0]!, symbol: "BBB", concept: "old_signal" },
    ];
    try {
      wrap();
      expect(await screen.findByText("2-day RSI below 10")).toBeTruthy();
      expect(screen.getByText("Old signal")).toBeTruthy();
    } finally {
      outcomesPayload = { status: { running: false, total: 0, done: 0, errors: 0 }, study: null };
    }
  });

  it("Load chart loads the symbol, selects it and opens the chart", async () => {
    wrap();
    fireEvent.click(await screen.findByRole("button", { name: "Load chart" }));
    await waitFor(() => expect(selectInstrument).toHaveBeenCalledWith("ds-aaa"));
    expect(loadSymbol).toHaveBeenCalledWith("AAA");
    expect(push).toHaveBeenCalledWith("/chart");
  });

  it("shows the empty states", async () => {
    alerts = { session: null, alerts: [], last_run: null };
    wrap();
    expect(await screen.findByText(/No alerts yet — run the study first, then Run now/)).toBeTruthy();
    cleanup();
    alerts = { session: "2025-03-10", alerts: [], last_run: { at: "2025-03-10T21:30:00Z" } };
    wrap();
    expect(await screen.findByText("No setups today")).toBeTruthy();
  });

  it("track record shows cost, and the too-few-cases text instead of a judgment", async () => {
    wrap();
    fireEvent.click(await screen.findByRole("radio", { name: "Track record" }));
    expect(await screen.findByText("too few cases yet")).toBeTruthy();
    expect(screen.queryByText("75%")).toBeNull(); // no hit rate shown under the minimum
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("enough cases")).toBeTruthy();
    expect(screen.getByText(/round-trip cost of 0\.10%/)).toBeTruthy();
    expect(screen.getByText(/history, not a forecast/)).toBeTruthy();
    expect(screen.getByText("+0.30%")).toBeTruthy();
  });
});
