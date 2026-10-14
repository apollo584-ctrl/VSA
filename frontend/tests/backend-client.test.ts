// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendApi, clearBackendCaches } from "@/lib/api/backend/client";

const read = (f: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../../backend/fixtures", f), "utf8"));

beforeEach(() => {
  clearBackendCaches();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://test/api/v1");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearBackendCaches(); });

describe("analysis HTTP requests", () => {
  it.each([5, 60])("supplies a TPO interval compatible with %i-minute bars", async (minutes) => {
    const dataset = read("dataset_response.json");
    dataset.source.timeframe_minutes = minutes;
    dataset.source.session_mode = minutes === 60 ? "extended" : "regular";
    const analysis = read("analysis_response.json");
    const bars = read("bars_response.json");
    let submitted: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      let value: unknown;
      if (url.includes("/datasets/")) value = dataset;
      else if (url.includes("/market/bars?")) value = bars;
      else if (url.endsWith("/analyze")) { submitted = JSON.parse(init!.body as string); value = analysis; }
      else if (url.includes("/profiles?")) value = [];
      else throw new Error(`Unexpected request: ${url}`);
      return new Response(JSON.stringify(value), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await backendApi.getAnalysis({ symbol: dataset.id, asOf: Date.parse(bars[0].timestamp) / 1000 });
    expect(result.status).toBe("ok");
    expect(submitted).toEqual({ dataset_id: dataset.id, as_of: bars[0].available_at, parameters: { tpo_minutes: minutes === 60 ? 60 : 30 } });
  });

  it("reopens stored explanations without consulting the current catalog", async () => {
    const analysis = read("analysis_response.json");
    const bars = read("bars_response.json");
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/analyses/")) return new Response(JSON.stringify(analysis));
      if (url.includes("/market/bars?")) return new Response(JSON.stringify(bars));
      throw new Error(`The current catalog must not be consulted: ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const first = await backendApi.getSnapshot(analysis.id);
    clearBackendCaches(); // reopening after a service/catalog upgrade
    expect(await backendApi.getSnapshot(analysis.id)).toEqual(first);
    expect(fetcher.mock.calls.every(([url]) => !url.includes("/knowledge/"))).toBe(true);
    expect(first.vsaEvents[0]!.implications).toEqual(analysis.knowledge_snapshot.concepts.find((c: { id: string }) => c.id === first.vsaEvents[0]!.type).possible_interpretations);
  });
});
