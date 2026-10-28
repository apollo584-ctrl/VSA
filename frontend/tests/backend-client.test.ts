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
    analysis.persisted = false;
    analysis.id = null;
    const bars = read("bars_response.json");
    let submitted: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      let value: unknown;
      if (url.includes("/datasets/")) value = dataset;
      else if (url.includes("/market/bars?")) value = bars;
      else if (url.endsWith("/analyze")) { submitted = JSON.parse(init!.body as string); value = analysis; }
      else throw new Error(`Unexpected request: ${url}`);
      return new Response(JSON.stringify(value), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await backendApi.getAnalysis({ symbol: dataset.id, asOf: Date.parse(bars[0].timestamp) / 1000 });
    expect(result.status).toBe("ok");
    expect(submitted).toEqual({ dataset_id: dataset.id, persist: false, as_of: bars[0].available_at, parameters: { tpo_minutes: minutes === 60 ? 60 : 30 } });
    expect(result.persisted).toBe(false);
    expect(result.datasetId).toBe(dataset.id);
    expect(result.snapshot).toBeUndefined();
    expect(fetcher.mock.calls.some(([url]) => url.includes("/profiles?"))).toBe(false);
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

  it.each([
    { asOf: undefined, persist: undefined, expected: true },
    { asOf: undefined, persist: false, expected: false },
    { asOf: 1741012200, persist: true, expected: true },
  ])("honors latest/default and explicit persistence: $expected", async ({ asOf, persist, expected }) => {
    const dataset = read("dataset_response.json"), bars = read("bars_response.json"), analysis = read("analysis_response.json");
    analysis.persisted = expected;
    if (!expected) analysis.id = null;
    let submitted: { persist: boolean } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/datasets/")) return new Response(JSON.stringify(dataset));
      if (url.includes("/market/bars?")) return new Response(JSON.stringify(bars));
      if (url.endsWith("/analyze")) { submitted = JSON.parse(init!.body as string); return new Response(JSON.stringify(analysis)); }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const result = await backendApi.getAnalysis({ symbol: dataset.id, asOf, persist });
    expect(submitted!.persist).toBe(expected);
    expect(!!result.snapshot).toBe(expected);
  });
});

describe("daily candles (timeframe 1D)", () => {
  it("returns Yahoo daily bars as 1D candles at 09:30 ET, honouring to/limit, without 30m warnings", async () => {
    const dataset = read("dataset_response.json");
    const daily = { symbol: "X", bars: [
      { session: "2026-01-15", open: 1, high: 3, low: 0.5, close: 2, volume: 10 },
      { session: "2026-07-15", open: 2, high: 4, low: 1, close: 3, volume: 20 },
      { session: "2026-07-16", open: 3, high: 5, low: 2, close: 4, volume: 30 },
    ] };
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(url.includes("/daily-bars") ? daily : dataset), { status: 200 });
    }));
    const r = await backendApi.getBars({ symbol: dataset.id, timeframe: "1D" });
    expect(r.timeframe).toBe("1D");
    expect(r.bars.map((b) => b.t)).toEqual([
      Date.UTC(2026, 0, 15, 14, 30) / 1000, // EST (UTC-5)
      Date.UTC(2026, 6, 15, 13, 30) / 1000, // EDT (UTC-4)
      Date.UTC(2026, 6, 16, 13, 30) / 1000,
    ]);
    expect(r.bars[1]).toMatchObject({ o: 2, h: 4, l: 1, c: 3, v: 20 });
    expect(r.quality.issues).toEqual([]);
    expect(r.quality.barCount).toBe(3);
    expect(urls.some((u) => u.includes("/market/bars"))).toBe(false);
    const cut = await backendApi.getBars({ symbol: dataset.id, timeframe: "1D", to: r.bars[1]!.t, limit: 1 });
    expect(cut.bars.map((b) => b.c)).toEqual([3]);
  });
});

describe("one copy per stock", () => {
  const withId = (id: string, created_at: string) => ({ ...read("dataset_response.json"), id, created_at });
  const setup = () => {
    const sets: Record<string, unknown> = { a: withId("a", "2025-03-01T00:00:00Z"), b: withId("b", "2025-03-03T00:00:00Z"), c: withId("c", "2025-03-02T00:00:00Z"), z: withId("z", "2025-03-01T00:00:00Z") };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      let value: unknown;
      if (url.endsWith("/instruments")) value = { items: [{ instrument: "SPY", dataset_ids: ["a", "b", "c"] }, { instrument: "QQQ", dataset_ids: ["z"] }] };
      else if (url.includes("/datasets/")) value = sets[decodeURIComponent(url.split("/datasets/")[1]!)];
      else if (url.includes("/market/bars?")) value = read("bars_response.json");
      else throw new Error(`Unexpected request: ${url}`);
      return new Response(JSON.stringify(value), { status: 200 });
    }));
  };

  it("lists only the newest dataset of each instrument", async () => {
    setup();
    expect((await backendApi.listInstruments()).map((i) => i.symbol)).toEqual(["b", "z"]);
  });

  it("resolves any older dataset id to the newest one, and leaves unknown ids alone", async () => {
    setup();
    expect(await backendApi.resolveDataset("a")).toBe("b");
    expect(await backendApi.resolveDataset("c")).toBe("b");
    expect(await backendApi.resolveDataset("nope")).toBe("nope");
  });
});

describe("loading a typed symbol", () => {
  it("posts only the symbol and caches the returned dataset", async () => {
    const dataset = read("dataset_response.json");
    const fetcher = vi.fn(async () => new Response(JSON.stringify(dataset), { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await backendApi.loadSymbol("SPY")).toEqual({ datasetId: dataset.id, created: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://test/api/v1/datasets/from-symbol");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ symbol: "SPY" });
  });

  it.each([[422, "rejected", "No market data found for symbol ZZZZ"], [502, "http_error", "Market data provider could not be reached"]])(
    "surfaces the backend's %i message", async (status, code, detail) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail }), { status })));
      await expect(backendApi.loadSymbol("ZZZZ")).rejects.toMatchObject({ code, message: detail });
    });
});
