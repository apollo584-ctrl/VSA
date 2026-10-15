import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "@/components/layout/TopBar";
import { WorkspaceProvider, useWorkspace } from "@/hooks/workspace";
import { ApiError } from "@/lib/api/errors";
import type { Instrument } from "@/types";

const h = vi.hoisted(() => ({ mode: "http", listInstruments: vi.fn(), loadSymbol: vi.fn() }));
vi.mock("@/lib/api/client", () => ({
  get API_MODE() { return h.mode; },
  api: { listInstruments: h.listInstruments, loadSymbol: h.loadSymbol },
}));

const instrument = (symbol: string, label: string): Instrument => ({
  symbol, name: `${label} test`, label, exchange: "XNYS", timeframes: ["30m"], sessions: ["RTH"], availableDates: ["2025-03-03"],
  source: { name: "test", kind: "historical", note: "" },
} as Instrument);

function Probe() { return <output data-testid="selected">{useWorkspace().state.symbol ?? "none"}</output>; }
function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WorkspaceProvider><TopBar /><Probe /></WorkspaceProvider>
    </QueryClientProvider>,
  );
  return screen.getByLabelText(/Search instruments/);
}

beforeEach(() => { h.mode = "http"; h.listInstruments.mockResolvedValue([]); });
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

describe("typing a symbol in the top bar", () => {
  it("offers to load it, then selects the new dataset once the instrument list contains it", async () => {
    h.loadSymbol.mockImplementation(async () => {
      h.listInstruments.mockResolvedValue([instrument("ds-1", "SPY · 30m")]);
      return { datasetId: "ds-1" };
    });
    const box = setup();
    fireEvent.change(box, { target: { value: "spy" } });
    const option = await screen.findByRole("option", { name: /Load SPY from Yahoo Finance/ });
    expect(option.textContent).toContain("Not a live feed");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("ds-1"));
    expect(h.loadSymbol).toHaveBeenCalledWith("SPY");
    expect(h.listInstruments.mock.calls.length).toBeGreaterThan(1); // refetched after the load
  });

  it("shows the backend's message and selects nothing when the load fails", async () => {
    h.loadSymbol.mockRejectedValue(new ApiError("rejected", "No market data found for symbol ZZZZ", 422));
    const box = setup();
    fireEvent.change(box, { target: { value: "zzzz" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Load ZZZZ/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("No market data found for symbol ZZZZ");
    expect(screen.getByTestId("selected").textContent).toBe("none");
  });

  it("does not offer a load for text that is not a ticker, or in mock mode", async () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "not a ticker!" } });
    expect(screen.queryByRole("option", { name: /Load/ })).toBeNull();
    cleanup();
    h.mode = "mock";
    fireEvent.change(setup(), { target: { value: "spy" } });
    expect(screen.queryByRole("option", { name: /Load/ })).toBeNull();
  });
});
