import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import ChartPopoutPage from "@/app/chart/popout/page";
import { DEFAULT_LAYERS, WorkspaceProvider } from "@/hooks/workspace";
import { dailySmaForBars, exchangeDate, sma, smaUpTo } from "@/lib/charting/movingAverages";
import type { Bar, Layers } from "@/types";

const mocks = vi.hoisted(() => ({ bars: [] as unknown[], daily: { data: undefined, isError: false, isSuccess: false } as { data?: { bars: { session: string; close: number }[] }; isError: boolean; isSuccess: boolean } }));
vi.mock("@/hooks/data", () => ({
  useMarket: () => ({ instrument: { label: "SPY - 30m" }, bars: mocks.bars, allBars: mocks.bars, analysis: null }),
  useDailyBars: () => mocks.daily,
}));
vi.mock("@/components/charts/MarketChart", () => ({
  MarketChart: ({ layers, hidePopout, dailyBars }: { layers: Layers; hidePopout?: boolean; dailyBars?: unknown[] | null }) => (
    <div data-testid="chart" data-daily={String(dailyBars?.length ?? 0)} data-layers={Object.entries(layers).filter(([, v]) => v).map(([k]) => k).join(",")} data-hidepopout={String(!!hidePopout)} />
  ),
}));
afterEach(() => { cleanup(); localStorage.clear(); mocks.daily = { data: undefined, isError: false, isSuccess: false }; });

const bar = (i: number, c: number): Bar => ({ t: 1000 + i * 60, o: c, h: c, l: c, c, v: 1 });
const bars = Array.from({ length: 260 }, (_, i) => bar(i, i + 1));

it("computes simple moving averages and omits the warm-up points", () => {
  const ma50 = sma(bars, 50), ma200 = sma(bars, 200);
  expect(ma50).toHaveLength(260 - 49);
  expect(ma50[0]).toEqual({ time: bars[49]!.t, value: 25.5 }); // mean of 1..50
  expect(ma200).toHaveLength(260 - 199);
  expect(ma200[0]!.time).toBe(bars[199]!.t);
  expect(ma200[0]!.value).toBeCloseTo(100.5);
  expect(sma(bars.slice(0, 10), 50)).toEqual([]);
});

it("emits no moving-average points after the replay cutoff", () => {
  const visible = bars.slice(0, 120);
  const out = smaUpTo(bars, visible, 50);
  expect(out.at(-1)!.time).toBe(visible.at(-1)!.t);
  expect(out.every((p) => p.time <= visible.at(-1)!.t)).toBe(true);
  expect(smaUpTo(bars, visible, 200)).toEqual([]); // 200 line has not warmed up yet at bar 120
  expect(smaUpTo(bars, [], 50)).toEqual([]);
});

it("defaults to candles, volume and both averages", () => {
  const on = Object.entries(DEFAULT_LAYERS).filter(([, v]) => v).map(([k]) => k).sort();
  expect(on).toEqual(["candles", "ma200", "ma50", "volume"]);
});

it("pop-out renders the chart without a shell and switches between modes", async () => {
  render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "30m" }}><ChartPopoutPage /></WorkspaceProvider>);
  expect(screen.getByRole("heading")).toHaveTextContent("SPY - 30m");
  expect(screen.getByRole("heading")).toHaveTextContent("30m");
  expect(screen.getByTestId("chart")).toHaveAttribute("data-layers", "candles,volume,ma50,ma200");
  expect(screen.getByTestId("chart")).toHaveAttribute("data-hidepopout", "true");
  await userEvent.click(screen.getByRole("button", { name: "VSA + profile" }));
  const layers = screen.getByTestId("chart").getAttribute("data-layers")!.split(",");
  expect(layers).toEqual(expect.arrayContaining(["vsa", "volumeProfile", "valueLevels"]));
  expect(layers).not.toContain("ma50");
  expect(screen.getByRole("button", { name: "Full screen" })).toBeInTheDocument();
});

// ---- round 2: daily basis
const days = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  return { session: d.toISOString().slice(0, 10), close: i + 1 };
});
const barAt = (iso: string): Bar => ({ t: Date.parse(iso) / 1000, o: 1, h: 1, l: 1, c: 1, v: 1 });

it("daily SMA uses the last completed day (never the bar's own day) and omits warm-up", () => {
  const daily = days(60); // 2026-01-01 .. 2026-03-01, closes 1..60
  const today = barAt("2026-03-02T15:00:00Z");
  const sameDay = barAt("2026-03-02T19:00:00Z");
  const out = dailySmaForBars(daily, [today, sameDay], 50);
  expect(exchangeDate(today.t)).toBe("2026-03-02");
  expect(out).toHaveLength(2);
  expect(out[0]!.value).toBeCloseTo(35.3); // closes 12..60 (completed days) plus the bar's own close 1, over 50
  expect(out[1]!.value).toBe(out[0]!.value);
  const onLast = dailySmaForBars(daily, [barAt("2026-03-01T15:00:00Z")], 50);
  expect(onLast[0]!.value).toBeCloseTo(34.32); // closes 11..59 plus 1
  expect(dailySmaForBars(daily, [barAt("2026-02-10T15:00:00Z")], 50)).toEqual([]);
  expect(dailySmaForBars(daily, [today], 200)).toEqual([]);
});

it("replaces old saved layers lacking the averages but keeps other preferences", async () => {
  localStorage.setItem("mst.workspace.v1", JSON.stringify({ symbol: "QQQ", timeframe: "5m", theme: "light", layers: { candles: true, volume: true, vsa: true, volumeProfile: true } }));
  render(<WorkspaceProvider><ChartPopoutPage /></WorkspaceProvider>);
  await waitFor(() => expect(screen.getByTestId("chart")).toHaveAttribute("data-layers", "candles,volume,ma50,ma200"));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("mst.workspace.v1")!).symbol).toBe("QQQ"));
  const saved = JSON.parse(localStorage.getItem("mst.workspace.v1")!);
  expect(saved.theme).toBe("light");
  expect(saved.layers).toMatchObject({ ma50: true, ma200: true, vsa: false, volumeProfile: false });
  expect(saved.maBasis).toBe("daily");
});

it("keeps saved layers that already include the averages", async () => {
  localStorage.setItem("mst.layers.v2", "1");
  localStorage.setItem("mst.workspace.v1", JSON.stringify({ layers: { ...DEFAULT_LAYERS, ma200: false, vsa: true } }));
  render(<WorkspaceProvider><ChartPopoutPage /></WorkspaceProvider>);
  await waitFor(() => expect(JSON.parse(localStorage.getItem("mst.workspace.v1")!).layers).toMatchObject({ ma50: true, ma200: false, vsa: true }));
});

it("basis switch changes and remembers the choice, passes daily bars, and hides on 1D", async () => {
  mocks.daily = { data: { bars: days(60) }, isError: false, isSuccess: true };
  const { unmount } = render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "30m" }}><ChartPopoutPage /></WorkspaceProvider>);
  expect(screen.getByRole("button", { name: "Daily" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("chart")).toHaveAttribute("data-daily", "60");
  await userEvent.click(screen.getByRole("button", { name: "30 mins" }));
  expect(screen.getByTestId("chart")).toHaveAttribute("data-daily", "0");
  await waitFor(() => expect(JSON.parse(localStorage.getItem("mst.workspace.v1")!).maBasis).toBe("bars"));
  unmount(); localStorage.clear();
  render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "1D" }}><ChartPopoutPage /></WorkspaceProvider>);
  expect(screen.getByTestId("chart")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "30 mins" })).toBeNull();
});

it("falls back to chart bars with a note when the daily request fails or is empty", () => {
  mocks.daily = { data: undefined, isError: true, isSuccess: false };
  const { unmount } = render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "30m" }}><ChartPopoutPage /></WorkspaceProvider>);
  expect(screen.getByRole("status")).toHaveTextContent(/30-min averages/i);
  expect(screen.getByTestId("chart")).toHaveAttribute("data-daily", "0");
  unmount(); localStorage.clear();
  mocks.daily = { data: { bars: [] }, isError: false, isSuccess: true };
  render(<WorkspaceProvider initial={{ symbol: "SPY", timeframe: "30m" }}><ChartPopoutPage /></WorkspaceProvider>);
  expect(screen.getByRole("status")).toHaveTextContent(/30-min averages/i);
});
