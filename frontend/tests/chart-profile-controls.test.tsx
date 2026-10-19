import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarketChart } from "@/components/charts/MarketChart";
import { mockApi } from "@/fixtures/api";
import { DEFAULT_LAYERS, WorkspaceProvider, useWorkspace } from "@/hooks/workspace";
import type { Analysis } from "@/types";

const chart = vi.hoisted(() => {
  const series = { setData: vi.fn(), applyOptions: vi.fn(), setMarkers: vi.fn(), createPriceLine: vi.fn(() => ({})), removePriceLine: vi.fn() };
  const scale = { applyOptions: vi.fn(), fitContent: vi.fn(), options: () => ({ barSpacing: 9 }), subscribeVisibleLogicalRangeChange: vi.fn() };
  return { series, scale };
});
vi.mock("lightweight-charts", () => ({
  ColorType: { Solid: 0 }, CrosshairMode: { Normal: 0 }, LineStyle: { Solid: 0, Dashed: 1, Dotted: 2, SparseDotted: 3, LargeDashed: 4 },
  createChart: () => ({
    addCandlestickSeries: () => chart.series, addHistogramSeries: () => chart.series,
    timeScale: () => chart.scale, priceScale: () => ({ applyOptions: vi.fn(), width: () => 50 }),
    applyOptions: vi.fn(), subscribeCrosshairMove: vi.fn(), subscribeClick: vi.fn(), remove: vi.fn(),
  }),
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Harness({ analysis }: { analysis: Analysis }) {
  const { state } = useWorkspace();
  return <MarketChart bars={[]} fitKey="test" timeframe="30m" analysis={analysis} layers={state.layers}
    profileKind={state.profileKind} selectedEventId={null} onSelectEvent={() => {}} />;
}

it("changes the chart scope, displays its dates and keeps controls inside fullscreen", async () => {
  const analysis = await mockApi.getAnalysis({ symbol: "FIXA", timeframe: "30m", session: "RTH" });
  render(<WorkspaceProvider><Harness analysis={analysis} /></WorkspaceProvider>);
  await userEvent.selectOptions(screen.getByLabelText("Profile range"), "composite");
  expect(screen.getByRole("status")).toHaveTextContent(analysis.profiles.composite!.label);
  expect(screen.getByRole("status")).toHaveTextContent(/ET.*price range/);
  expect(chart.series.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: analysis.profiles.composite!.poc, title: "POC" }));

  const button = screen.getByRole("button", { name: "Full screen" });
  const frame = screen.getByRole("img", { name: /Candlestick chart/ }).parentElement!.parentElement!;
  const request = vi.fn(async () => {});
  Object.defineProperty(frame, "requestFullscreen", { configurable: true, value: request });
  await userEvent.click(button);
  expect(request).toHaveBeenCalledOnce();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: frame });
  act(() => document.dispatchEvent(new Event("fullscreenchange")));
  expect(screen.getByRole("button", { name: "Exit full screen" })).toHaveAttribute("aria-pressed", "true");
  expect(frame).toContainElement(screen.getByLabelText("Profile range"));
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});

it("does not draw substitute profile levels for an unavailable selection", async () => {
  const analysis = await mockApi.getAnalysis({ symbol: "FIXA", timeframe: "30m", session: "RTH" });
  delete analysis.profiles.prior;
  render(<WorkspaceProvider initial={{ profileKind: "prior", layers: { ...DEFAULT_LAYERS, nodes: false, structure: false } }}><Harness analysis={analysis} /></WorkspaceProvider>);
  expect(screen.getByRole("status")).toHaveTextContent(/Selected profile unavailable/);
  expect(chart.series.createPriceLine).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByLabelText("Profile range"), "volume");
  expect(chart.series.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: analysis.profiles.volume!.poc }));
});

it("lets users turn the profile histogram on in fullscreen without leaving the chart", async () => {
  const analysis = await mockApi.getAnalysis({ symbol: "FIXA", timeframe: "30m", session: "RTH" });
  render(<WorkspaceProvider initial={{ layers: { ...DEFAULT_LAYERS, volumeProfile: false } }}><Harness analysis={analysis} /></WorkspaceProvider>);
  const toggle = screen.getByRole("checkbox", { name: "Show profile histogram" });
  expect(toggle).not.toBeChecked();
  await userEvent.click(toggle);
  expect(toggle).toBeChecked();
});
