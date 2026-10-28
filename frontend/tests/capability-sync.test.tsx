import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CapabilitySync } from "@/components/layout/CapabilitySync";
import { mapDatasetToInstrument } from "@/lib/api/backend/mappers";
import { WorkspaceProvider, useWorkspace } from "@/hooks/workspace";

const h = vi.hoisted(() => ({ timeframes: ["30m", "1D"] }));
vi.mock("@/hooks/data", () => ({
  useInstruments: () => ({ data: [{ symbol: "ds-1", timeframes: h.timeframes, sessions: ["RTH"] }] }),
}));
afterEach(() => { cleanup(); localStorage.clear(); });

function Probe() { return <output data-testid="tf">{useWorkspace().state.timeframe}</output>; }
const mount = () => render(<WorkspaceProvider initial={{ symbol: "ds-1", timeframe: "1D" }}><CapabilitySync /><Probe /></WorkspaceProvider>);

it("a loaded 30-minute stock also offers daily candles", () => {
  const d = { id: "ds-1", source: { instrument: "XOM", timeframe_minutes: 30, session_mode: "regular", source_name: "yahoo", exchange: "XNYS", is_demo: false } };
  expect(mapDatasetToInstrument(d as never, []).timeframes).toEqual(["30m", "1D"]);
});

it("keeps 1D selected when the stock offers it", async () => {
  h.timeframes = ["30m", "1D"];
  const { getByTestId } = mount();
  await new Promise((r) => setTimeout(r, 20));
  expect(getByTestId("tf").textContent).toBe("1D");
});

it("still switches to what the stock offers when 1D is not available", async () => {
  h.timeframes = ["30m"];
  const { getByTestId } = mount();
  await waitFor(() => expect(getByTestId("tf").textContent).toBe("30m"));
});
