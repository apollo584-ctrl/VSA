import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "@/components/layout/TopBar";
import { WorkspaceProvider, useWorkspace } from "@/hooks/workspace";
import { ApiError } from "@/lib/api/errors";
import type { Instrument } from "@/types";

const h = vi.hoisted(() => ({ mode: "http", listInstruments: vi.fn(), loadSymbol: vi.fn(), collectIntraday: vi.fn(), resolveDataset: vi.fn() }));
vi.mock("@/lib/api/client", () => ({
  get API_MODE() { return h.mode; },
  api: { listInstruments: h.listInstruments, loadSymbol: h.loadSymbol, collectIntraday: h.collectIntraday, resolveDataset: h.resolveDataset },
}));

const instrument = (symbol: string, label: string): Instrument => ({
  symbol, name: `${label} test`, label, exchange: "XNYS", timeframes: ["30m"], sessions: ["RTH"], availableDates: ["2025-03-03"],
  source: { name: "test", kind: "historical", note: "" },
} as Instrument);

// Only the symbol list; the "As of" select has its own <option> elements.
const listed = () => { const box = screen.queryByRole("listbox"); return box ? within(box).queryAllByRole("option") : []; };
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

describe("clearing the symbol list", () => {
  it("hides the listed symbols, deselects the current one, keeps them out after a reload, and can restore them", async () => {
    h.listInstruments.mockResolvedValue([instrument("ds-1", "SPY · 30m"), instrument("ds-2", "AAPL · 30m")]);
    localStorage.setItem("mst.workspace.v1", JSON.stringify({ symbol: "ds-1" }));
    const box = setup();
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("ds-1"));
    fireEvent.focus(box);
    await waitFor(() => expect(listed().length).toBe(2));
    fireEvent.mouseDown(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(listed().length).toBe(0));
    expect(screen.getByTestId("selected").textContent).toBe("none");
    expect(JSON.parse(localStorage.getItem("mst.hiddenInstruments.v1")!)).toEqual(["ds-1", "ds-2"]);
    cleanup();
    const again = setup();
    fireEvent.focus(again);
    await screen.findByText(/List cleared/);
    expect(listed().length).toBe(0);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Show 2 cleared" }));
    await waitFor(() => expect(listed().length).toBe(2));
    expect(localStorage.getItem("mst.hiddenInstruments.v1")).toBe("[]");
  });

  it("shows a cleared symbol again when it is loaded again", async () => {
    h.listInstruments.mockResolvedValue([instrument("ds-1", "SPY · 30m")]);
    h.loadSymbol.mockResolvedValue({ datasetId: "ds-1" });
    localStorage.setItem("mst.hiddenInstruments.v1", JSON.stringify(["ds-1"]));
    const box = setup();
    fireEvent.change(box, { target: { value: "spy" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Load SPY/ }));
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("ds-1"));
    expect(localStorage.getItem("mst.hiddenInstruments.v1")).toBe("[]");
  });
});

describe("Refresh button", () => {
  it("re-fetches the symbol on screen and selects the new copy of the data", async () => {
    localStorage.setItem("mst.workspace.v1", JSON.stringify({ symbol: "ds-old" }));
    h.listInstruments.mockResolvedValue([instrument("ds-old", "XOM · 30m")]);
    h.loadSymbol.mockResolvedValue({ datasetId: "ds-new" });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("ds-new"));
    expect(h.loadSymbol).toHaveBeenCalledWith("XOM");
  });

  it("refreshes every listed stock, selects the new copy on screen and starts the history update once", async () => {
    localStorage.setItem("mst.workspace.v1", JSON.stringify({ symbol: "ds-xom" }));
    h.listInstruments.mockResolvedValue([instrument("ds-xom", "XOM · 30m"), instrument("ds-spy", "SPY · 30m"), instrument("ds-aapl", "AAPL · 30m")]);
    h.loadSymbol.mockImplementation(async (t: string) => ({ datasetId: `new-${t}` }));
    h.collectIntraday.mockResolvedValue({ running: true });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("new-XOM"));
    expect(h.loadSymbol.mock.calls.map((c) => c[0]).sort()).toEqual(["AAPL", "SPY", "XOM"]);
    await waitFor(() => expect(h.collectIntraday).toHaveBeenCalledTimes(1));
  });

  it("keeps a stock picked while the refresh is still running", async () => {
    localStorage.setItem("mst.workspace.v1", JSON.stringify({ symbol: "ds-xom" }));
    h.listInstruments.mockResolvedValue([instrument("ds-xom", "XOM · 30m"), instrument("ds-spy", "SPY · 30m")]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    h.loadSymbol.mockImplementation(async (t: string) => { await gate; return { datasetId: `new-${t}` }; });
    h.collectIntraday.mockResolvedValue({ running: true });
    const box = setup();
    fireEvent.click(await screen.findByRole("button", { name: /Refresh/ }));
    fireEvent.change(box, { target: { value: "SPY · 30m" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /SPY · 30m/ }));
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("ds-spy"));
    release();
    await waitFor(() => expect(h.collectIntraday).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("selected").textContent).toBe("ds-spy");
  });

  it("reports the stocks that could not refresh", async () => {
    localStorage.setItem("mst.workspace.v1", JSON.stringify({ symbol: "ds-xom" }));
    h.listInstruments.mockResolvedValue([instrument("ds-xom", "XOM · 30m"), instrument("ds-spy", "SPY · 30m"), instrument("ds-aapl", "AAPL · 30m")]);
    h.loadSymbol.mockImplementation(async (t: string) => { if (t === "SPY") throw new ApiError("http_error", "provider down", 502); return { datasetId: `new-${t}` }; });
    h.collectIntraday.mockResolvedValue({ running: true });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /Refresh/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("1 of 3 stocks could not refresh");
    expect(alert.getAttribute("title")).toBe("SPY: provider down");
    expect(h.collectIntraday).toHaveBeenCalledTimes(1);
  });

  it("is hidden in mock mode and without a symbol on screen", async () => {
    h.mode = "mock";
    h.listInstruments.mockResolvedValue([instrument("ds-old", "XOM · 30m")]);
    localStorage.setItem("mst.workspace.v1", JSON.stringify({ symbol: "ds-old" }));
    setup();
    await screen.findByLabelText(/Search instruments/);
    expect(screen.queryByRole("button", { name: /Refresh/ })).toBeNull();
  });
});
