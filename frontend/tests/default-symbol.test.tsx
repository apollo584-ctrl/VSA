import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const selectInstrument = vi.fn();
const loadSymbol = vi.fn();
let workspace = { state: { symbol: null as string | null }, ready: true, selectInstrument };
let instruments: { symbol: string; label: string }[] = [];

vi.mock("@/hooks/workspace", () => ({ useWorkspace: () => workspace }));
vi.mock("@/lib/api/client", () => ({ API_MODE: "http" }));
vi.mock("@/hooks/data", () => ({
  useInstruments: () => ({ data: instruments }),
  useLoadSymbol: () => ({ mutate: (s: string, o: { onSuccess: (r: { datasetId: string }) => void }) => { loadSymbol(s); o.onSuccess({ datasetId: "ds-new" }); } }),
}));

import { DefaultSymbol } from "@/components/layout/DefaultSymbol";

function mount() {
  return render(<QueryClientProvider client={new QueryClient()}><DefaultSymbol /></QueryClientProvider>);
}

describe("DefaultSymbol", () => {
  beforeEach(() => { selectInstrument.mockClear(); loadSymbol.mockClear(); workspace = { state: { symbol: null }, ready: true, selectInstrument }; instruments = []; });

  it("loads and selects SPY when nothing is saved", async () => {
    mount();
    await waitFor(() => expect(selectInstrument).toHaveBeenCalledWith("ds-new"));
    expect(loadSymbol).toHaveBeenCalledWith("SPY");
  });

  it("selects an existing SPY dataset without downloading again", async () => {
    instruments = [{ symbol: "ds-spy", label: "SPY · 30m" }];
    mount();
    await waitFor(() => expect(selectInstrument).toHaveBeenCalledWith("ds-spy"));
    expect(loadSymbol).not.toHaveBeenCalled();
  });

  it("leaves a remembered symbol alone and waits for saved settings to be read", async () => {
    workspace = { state: { symbol: "ds-other" }, ready: true, selectInstrument };
    mount();
    workspace = { state: { symbol: null }, ready: false, selectInstrument };
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(selectInstrument).not.toHaveBeenCalled();
    expect(loadSymbol).not.toHaveBeenCalled();
  });
});
