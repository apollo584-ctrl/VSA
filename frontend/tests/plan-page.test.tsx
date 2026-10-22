import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlanPage from "@/app/plan/page";
import { ApiError } from "@/lib/api/errors";

let mode: "ok" | "mock" = "ok";
let summary = { date: "d", trades: 0, losses: 0, realized_pnl: 0 };
const createJournal = vi.fn((_b: unknown) => Promise.resolve({}));
const unsupported = () => Promise.reject(new ApiError("not_supported", "needs the real backend", 0));
const aaa = {
  symbol: "AAA", stage: "triggered", acceptance_closes: 3, retest_bars_left: null, prior_vah: 50, prior_val: 48, prior_poc: 49,
  entry_reference: 50, stop: 49.5, target: 51, contradiction: false, no_trade_reasons: [], explanation: "Three closes above value, then a retest that held.",
};
vi.mock("@/lib/api/client", () => ({
  api: {
    getSetupA: (s: string[]) => (mode === "mock" ? unsupported() : Promise.resolve({ as_of: null, symbols: s.map((symbol) => ({ ...aaa, symbol })) })),
    getJournal: () => (mode === "mock" ? unsupported() : Promise.resolve([{ id: 1, trade_date: "2026-10-22", symbol: "AAA", kind: "taken", entry: 50, stop: 49.5, target: 51, shares: 40 }])),
    getDaySummary: () => (mode === "mock" ? unsupported() : Promise.resolve(summary)),
    createJournal: (b: unknown) => createJournal(b),
    updateJournal: vi.fn(), journalCsvUrl: () => (mode === "mock" ? null : "http://x/api/v1/journal/export.csv"),
  },
}));

beforeEach(() => {
  mode = "ok"; summary = { date: "d", trades: 0, losses: 0, realized_pnl: 0 }; createJournal.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem("plan.watchlist", JSON.stringify(["AAA"]));
});
afterEach(cleanup);
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlanPage /></QueryClientProvider>);

describe("Today's Plan page", () => {
  it("shows the note, checklist, watchlist card and journal", async () => {
    wrap();
    expect(screen.getByText(/not advice and it never places orders/i)).toBeTruthy();
    expect(screen.getByText("Before the session")).toBeTruthy();
    expect(await screen.findByText("Triggered")).toBeTruthy();
    expect(screen.getByText(/3\/3/)).toBeTruthy();
    expect(await screen.findByText("Download CSV")).toBeTruthy();
  });

  it("fills the calculator from a triggered card and logs a trade", async () => {
    wrap();
    fireEvent.click(await screen.findByText("Use in calculator"));
    await waitFor(() => expect(screen.getByTestId("shares").textContent).toBe("40"));
    expect(screen.getByTestId("loss").textContent).toBe("$22.00");
    expect(screen.getByTestId("profit").textContent).toBe("$38.00");
    fireEvent.click(screen.getByText("Log trade"));
    await waitFor(() => expect(createJournal).toHaveBeenCalled());
    expect((createJournal.mock.calls[0]![0] as { kind: string; shares: number }).shares).toBe(40);
  });

  it("blocks Log trade after three losses", async () => {
    summary = { date: "d", trades: 3, losses: 3, realized_pnl: -30 };
    wrap();
    expect(await screen.findByText(/Daily limit reached/)).toBeTruthy();
    fireEvent.click(await screen.findByText("Use in calculator"));
    await waitFor(() => expect(screen.getByTestId("shares")).toBeTruthy());
    expect((screen.getByText("Log trade") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps Log trade blocked when today's results cannot be loaded", async () => {
    mode = "mock";
    wrap();
    await waitFor(() => expect(screen.getAllByText(/could not be loaded from the journal/).length).toBeGreaterThan(0));
    expect((screen.getByText("Log trade") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not save one symbol's levels against another typed-in symbol", async () => {
    wrap();
    fireEvent.click(await screen.findByText("Use in calculator"));
    await waitFor(() => expect(screen.getByTestId("shares").textContent).toBe("40"));
    fireEvent.change(screen.getByLabelText("Trade symbol"), { target: { value: "ZZZ" } });
    fireEvent.click(screen.getByText("Log trade"));
    await waitFor(() => expect(createJournal).toHaveBeenCalled());
    expect((createJournal.mock.calls[0]![0] as { prior_vah: number | null }).prior_vah).toBeNull();
  });

  it("saves checklist ticks per date", async () => {
    wrap();
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    const saved = Object.entries(window.localStorage).find(([k]) => k.startsWith("plan.checklist."));
    expect(saved && JSON.parse(saved[1])[0]).toBe(true);
  });

  it("explains the need for the real backend in mock mode instead of crashing", async () => {
    mode = "mock";
    wrap();
    await waitFor(() => expect(screen.getAllByText("This needs the real backend").length).toBeGreaterThanOrEqual(2));
  });
});
