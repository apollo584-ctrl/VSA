import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import ChartPopoutPage from "@/app/chart/popout/page";
import { ChartSection } from "@/components/charts/ChartSection";
import { WorkspaceProvider } from "@/hooks/workspace";
import type { Layers } from "@/types";

vi.mock("@/hooks/data", () => ({
  useMarket: () => ({ instrument: { label: "SPY - 30m" }, bars: [], allBars: [], analysis: null }),
  useDailyBars: () => ({ data: undefined, isError: false, isSuccess: false }),
}));
vi.mock("@/components/charts/MarketChart", () => ({
  MarketChart: ({ layers, onLayersChange }: { layers: Layers; onLayersChange?: (l: Layers) => void }) => (
    <div>
      <div data-testid="chart" data-layers={Object.entries(layers).filter(([, v]) => v).map(([k]) => k).join(",")} />
      <button onClick={() => onLayersChange?.({ ...layers, volumeProfile: !layers.volumeProfile })}>histogram</button>
    </div>
  ),
}));
afterEach(() => { cleanup(); localStorage.clear(); });

const market = { bars: [], allBars: [], analysis: null, instrument: null, error: null } as never;

it("VSA page section starts with candles, volume, VSA and levels on, independent of workspace defaults", async () => {
  render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "30m" }}>
    <ChartSection market={market} hideProfile layerKeys={["candles", "volume", "vsa", "structure"]} />
  </WorkspaceProvider>);
  expect(screen.getByTestId("chart")).toHaveAttribute("data-layers", "candles,volume,vsa,structure");
  await userEvent.click(screen.getByRole("switch", { name: "VSA" }));
  expect(screen.getByTestId("chart")).toHaveAttribute("data-layers", "candles,volume,structure");
});

it("main chart section still follows the workspace layers", () => {
  render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "30m" }}><ChartSection market={market} /></WorkspaceProvider>);
  expect(screen.getByTestId("chart")).toHaveAttribute("data-layers", "candles,volume,ma50,ma200");
});

it("pop-out histogram control changes the chart layers per mode and leaves workspace prefs alone", async () => {
  render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "30m" }}><ChartPopoutPage /></WorkspaceProvider>);
  expect(screen.getByTestId("chart").getAttribute("data-layers")).not.toContain("volumeProfile");
  await userEvent.click(screen.getByRole("button", { name: "histogram" }));
  expect(screen.getByTestId("chart").getAttribute("data-layers")).toContain("volumeProfile");
  await userEvent.click(screen.getByRole("button", { name: "VSA + profile" }));
  await userEvent.click(screen.getByRole("button", { name: "histogram" }));
  expect(screen.getByTestId("chart").getAttribute("data-layers")).not.toContain("volumeProfile");
  expect(localStorage.getItem("mst.workspace.v1") ?? "").not.toContain("volumeProfile\":true");
});
