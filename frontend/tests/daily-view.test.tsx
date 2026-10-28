import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChartSection } from "@/components/charts/ChartSection";
import type { Market } from "@/components/common/AnalysisGate";
import { WorkspaceProvider } from "@/hooks/workspace";

vi.mock("@/hooks/maBasis", () => ({ useMaBasis: () => ({ basis: "daily", setBasis: () => undefined, show: false, dailyBars: null, fellBack: false }) }));
vi.mock("@/components/charts/ChartControls", () => ({
  LayerControls: () => null, MaBasisSwitch: () => null, ReplayControls: () => <div data-testid="replay" />,
}));
vi.mock("@/components/charts/MarketChart", () => ({
  MarketChart: ({ analysis }: { analysis: unknown }) => <div data-testid="chart" data-analysis={String(analysis !== null)} />,
}));
afterEach(() => { cleanup(); localStorage.clear(); });

const analysis = { status: "ok", timeframe: "30m", session: "RTH", analysisTimeframe: "30m" } as unknown as NonNullable<Market["analysis"]>;
const market = (dailyView: boolean) => ({ dailyView, bars: [], allBars: [], analysis, analysisIsStale: false, barsResponse: null, error: null, asOf: null, instrument: null }) as unknown as Market;

it("1D shows daily candles without 30-minute overlays or replay, and says so", () => {
  render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "1D" }}><ChartSection market={market(true)} /></WorkspaceProvider>);
  expect(screen.getByTestId("chart")).toHaveAttribute("data-analysis", "false");
  expect(screen.queryByTestId("replay")).toBeNull();
  expect(screen.getByText("Daily candles from Yahoo Finance. The panels use 30-minute data.")).toBeInTheDocument();
  expect(screen.queryByText(/Annotations were computed on/)).toBeNull();
});

it("30m keeps the overlays and replay controls", () => {
  render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "30m" }}><ChartSection market={market(false)} /></WorkspaceProvider>);
  expect(screen.getByTestId("chart")).toHaveAttribute("data-analysis", "true");
  expect(screen.getByTestId("replay")).toBeInTheDocument();
  expect(screen.queryByText(/Daily candles from Yahoo/)).toBeNull();
});

