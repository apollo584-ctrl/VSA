import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useMarket } from "@/hooks/data";
import { WorkspaceProvider } from "@/hooks/workspace";

const h = vi.hoisted(() => ({ getBars: vi.fn(), getAnalysis: vi.fn(), listInstruments: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ API_MODE: "http", api: h }));
afterEach(() => { localStorage.clear(); vi.clearAllMocks(); });

function wrap(timeframe: string) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WorkspaceProvider initial={{ symbol: "ds-1", timeframe, replayTime: 1_700_000_000 }}>{children}</WorkspaceProvider>
    </QueryClientProvider>
  );
}

it("on 1D a leftover replay position is ignored: latest 30-minute analysis, all daily bars", async () => {
  h.listInstruments.mockResolvedValue([]);
  h.getBars.mockResolvedValue({ bars: [{ t: 1_600_000_000, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: 1_800_000_000, o: 1, h: 1, l: 1, c: 1, v: 1 }] });
  h.getAnalysis.mockResolvedValue(null);
  const { result } = renderHook(() => useMarket(), { wrapper: wrap("1D") });
  await waitFor(() => expect(h.getAnalysis).toHaveBeenCalled());
  expect(h.getAnalysis.mock.calls[0]![0].asOf).toBeUndefined();
  await waitFor(() => expect(result.current.bars).toHaveLength(2));
  expect(result.current.dailyView).toBe(true);
  expect(result.current.replaying).toBe(false);
});

it("on 30m the replay position still applies", async () => {
  h.listInstruments.mockResolvedValue([]);
  h.getBars.mockResolvedValue({ bars: [] });
  h.getAnalysis.mockResolvedValue(null);
  const { result } = renderHook(() => useMarket(), { wrapper: wrap("30m") });
  await waitFor(() => expect(h.getAnalysis).toHaveBeenCalled());
  expect(h.getAnalysis.mock.calls[0]![0].asOf).toBe(1_700_000_000);
  expect(result.current.dailyView).toBe(false);
});
