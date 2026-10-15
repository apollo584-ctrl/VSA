import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useMarket } from "@/hooks/data";
import { WorkspaceProvider, useWorkspace } from "@/hooks/workspace";
import { barsResponse, mapAnalysis } from "@/lib/api/backend/mappers";
import type { Analysis } from "@/types";

const stubs = vi.hoisted(() => ({ getAnalysis: vi.fn(), getBars: vi.fn(), listInstruments: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: stubs }));
const read = (f: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../../backend/fixtures", f), "utf8"));
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

describe("market selection while analysis is pending or failed", () => {
  it.each(["resolve", "reject"])("withholds future analytical content during replay and on %s", async (outcome) => {
    const raw = read("analysis_response.json"), dataset = read("dataset_response.json"), bars = read("bars_response.json");
    const latest = mapAnalysis(raw, { bars });
    let resolve!: (a: Analysis) => void;
    let reject!: (e: Error) => void;
    stubs.getAnalysis.mockResolvedValueOnce(latest).mockImplementation(() => new Promise<Analysis>((yes, no) => { resolve = yes; reject = no; }));
    stubs.getBars.mockResolvedValue(barsResponse(dataset, bars));
    stubs.listInstruments.mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}><WorkspaceProvider initial={{ symbol: dataset.id, timeframe: "5m", session: "RTH" }}>{children}</WorkspaceProvider></QueryClientProvider>;
    }
    const { result } = renderHook(() => ({ market: useMarket(), workspace: useWorkspace() }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.market.analysis?.asOf).toBe(latest.asOf));
    const cursor = Date.parse(bars[200].timestamp) / 1000;
    act(() => result.current.workspace.set({ replayTime: cursor }));
    expect(result.current.market.analysis).toBeNull(); // including the debounce interval
    expect(result.current.market.bars.at(-1)!.t).toBe(cursor);
    await waitFor(() => expect(stubs.getAnalysis).toHaveBeenCalledWith(expect.objectContaining({ asOf: cursor })));
    expect(result.current.market.analysis).toBeNull();
    if (outcome === "reject") {
      await act(async () => reject(new Error("analysis failed")));
      await waitFor(() => expect(result.current.market.error?.message).toBe("analysis failed"));
      expect(result.current.market.analysis).toBeNull();
    } else {
      const historical = { ...latest, asOf: cursor, persisted: false, snapshot: undefined, datasetId: dataset.id, profiles: {}, interpretation: null };
      await act(async () => resolve(historical));
      await waitFor(() => expect(result.current.market.analysis?.asOf).toBe(cursor));
      expect(result.current.market.analysis?.profiles).toEqual({});
      expect(result.current.market.analysis?.snapshot).toBeUndefined();
    }
    client.clear();
  });
});
