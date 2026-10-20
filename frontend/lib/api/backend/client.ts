/** HTTP client for the Codex backend (docs/API_CONTRACT.md). Base URL includes the /api/v1 prefix. */
import { z } from "zod";
import type { Analysis, BarsResponse, Instrument, KnowledgeConcept, UploadResult } from "@/types";
import { ApiError } from "../errors";
import { epoch, barsResponse, mapAnalysis, mapConcept, mapDatasetToInstrument, mapQuality, mapSource } from "./mappers";
import {
  rawAnalysisSchema, rawBarSchema, rawConceptSchema, rawDatasetSchema, rawInstrumentsSchema, rawScanSchema, rawScanStatusSchema, rawOutcomesSchema, rawIntradaySchema, rawJobStatusSchema, rawAuthStatusSchema,
  type RawAnalysis, type RawBar, type RawConcept, type RawDataset,
} from "./schemas";

/** A localhost backend URL follows the page host, so a LAN device opening http://<pc-ip>:3000 reaches http://<pc-ip>:8000. */
export function resolveBase(configured: string, pageHost?: string): string {
  const url = configured.replace(/\/$/, "");
  if (!url || !pageHost) return url;
  try {
    const u = new URL(url);
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && pageHost !== "localhost" && pageHost !== "127.0.0.1") {
      u.hostname = pageHost.includes(":") && !pageHost.startsWith("[") ? `[${pageHost}]` : pageHost;
      return u.toString().replace(/\/$/, "");
    }
  } catch { /* keep configured */ }
  return url;
}

const base = () => resolveBase(process.env.NEXT_PUBLIC_API_BASE_URL ?? "", typeof window === "undefined" ? undefined : window.location.hostname);

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn; }

function detailMessage(body: unknown): string | null {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (typeof x === "object" && x && "msg" in x ? `${(x as { loc?: unknown[] }).loc?.slice(1).join(".") ?? ""}: ${(x as { msg: string }).msg}` : String(x))).join("; ");
  return null;
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  if (!base()) throw new ApiError("unavailable", "No backend URL configured (NEXT_PUBLIC_API_BASE_URL).", 0);
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { ...init, credentials: "include", headers: { Accept: "application/json", ...(init?.method && init.method !== "GET" ? { "X-MSI-Request": "1" } : {}), ...init?.headers } });
  } catch {
    throw new ApiError("unavailable", "The analysis service could not be reached.", 0);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = detailMessage(body) ?? `Request failed (${res.status})`;
    if (res.status === 401) {
      if (path !== "/auth/login") onUnauthorized?.();
      throw new ApiError("unauthorized", msg, 401, body);
    }
    if (res.status === 429) throw new ApiError("rate_limited", msg, 429, { retryAfter: Number(res.headers.get("Retry-After")) || undefined });
    throw new ApiError(res.status === 422 ? "rejected" : res.status === 404 ? "not_found" : "http_error", msg, res.status, body);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError("invalid_response", "The service returned data that does not match the documented contract.", res.status, parsed.error.issues.slice(0, 5));
  return parsed.data;
}

// ---- caches (datasets, bars and the concept catalog are immutable per id / version)
const datasetCache = new Map<string, Promise<RawDataset>>();
const barsCache = new Map<string, Promise<RawBar[]>>();
let conceptsCache: Promise<RawConcept[]> | null = null;

export function clearBackendCaches() {
  datasetCache.clear(); barsCache.clear(); conceptsCache = null;
}

const getDataset = (id: string) => {
  let p = datasetCache.get(id);
  if (!p) { p = request(`/datasets/${encodeURIComponent(id)}`, rawDatasetSchema); datasetCache.set(id, p); p.catch(() => datasetCache.delete(id)); }
  return p;
};

const PAGE = 10000;
async function fetchAllBars(id: string): Promise<RawBar[]> {
  const out: RawBar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await request(`/market/bars?dataset_id=${encodeURIComponent(id)}&offset=${offset}&limit=${PAGE}`, z.array(rawBarSchema));
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}
const getAllBars = (id: string) => {
  let p = barsCache.get(id);
  if (!p) { p = fetchAllBars(id); barsCache.set(id, p); p.catch(() => barsCache.delete(id)); }
  return p;
};

const getConcepts = () => {
  if (!conceptsCache) { conceptsCache = request("/knowledge/concepts", z.array(rawConceptSchema)); conceptsCache.catch(() => { conceptsCache = null; }); }
  return conceptsCache;
};

/** UI cursor times are bar START times; the backend filters on available_at (bar END). */
function asOfIso(bars: RawBar[], asOf: number | undefined): string | undefined {
  if (asOf === undefined) return undefined;
  const bar = bars.find((b) => epoch(b.timestamp) === asOf);
  return bar ? bar.available_at : new Date(asOf * 1000).toISOString();
}

async function snapshotToUi(raw: RawAnalysis): Promise<Analysis> {
  const bars = await getAllBars(raw.dataset_id);
  return mapAnalysis(raw, { bars });
}

export const backendApi = {
  async health() {
    return request("/health", z.object({ status: z.string(), engine_version: z.string(), knowledge_version: z.string(), live_data: z.boolean() }));
  },

  async listInstruments(q?: string): Promise<Instrument[]> {
    const { items } = await request("/instruments", rawInstrumentsSchema);
    const ids = items.flatMap((i) => i.dataset_ids);
    const all = await Promise.all(ids.map(async (id) => mapDatasetToInstrument(await getDataset(id), await getAllBars(id))));
    const needle = q?.trim().toLowerCase();
    return needle ? all.filter((i) => `${i.label} ${i.name}`.toLowerCase().includes(needle)) : all;
  },

  async getBars(p: { symbol: string; to?: number; limit?: number }): Promise<BarsResponse> {
    const [d, bars] = await Promise.all([getDataset(p.symbol), getAllBars(p.symbol)]);
    let sel = p.to === undefined ? bars : bars.filter((b) => epoch(b.timestamp) <= p.to!);
    if (p.limit) sel = sel.slice(-p.limit);
    return barsResponse(d, sel);
  },

  async getAnalysis(p: { symbol: string; asOf?: number; persist?: boolean }): Promise<Analysis> {
    const [d, bars] = await Promise.all([getDataset(p.symbol), getAllBars(p.symbol)]);
    const as_of = asOfIso(bars, p.asOf);
    const persist = p.persist ?? (p.asOf === undefined);
    let raw: RawAnalysis;
    try {
      raw = await request("/analyze", rawAnalysisSchema, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset_id: p.symbol, persist, parameters: { tpo_minutes: Math.max(30, d.source.timeframe_minutes) }, ...(as_of ? { as_of } : {}) }) });
      if (raw.persisted !== persist) throw new ApiError("invalid_response", "The service did not honor the requested analysis persistence mode.", 200);
    } catch (e) {
      if (e instanceof ApiError && e.code === "rejected") {
        // Domain rejection (no bars at as_of, split suspected, …): the chart stays viewable, analysis is withheld.
        const insufficient = /no completed bars/i.test(e.message);
        return {
          symbol: d.source.instrument, datasetId: d.id, timeframe: `${d.source.timeframe_minutes}m`, session: d.source.session_mode === "regular" ? "RTH" : "ETH",
          asOf: p.asOf ?? epoch(d.last_available_at), generatedAt: d.created_at, source: mapSource(d.source),
          status: insufficient ? "insufficient_data" : "invalid_data", statusMessage: e.message,
          quality: mapQuality(d.quality, bars, true), profiles: {}, valueLocation: null, vsaEvents: [], auctionStates: [], auctionTransitions: [], levels: [], interpretation: null,
        };
      }
      throw e;
    }
    return snapshotToUi(raw);
  },

  /** Reopen an immutable persisted snapshot (GET /analyses/{id}). Nothing is recomputed. */
  async getSnapshot(id: string): Promise<Analysis> {
    const raw = await request(`/analyses/${encodeURIComponent(id)}`, rawAnalysisSchema);
    return snapshotToUi(raw);
  },

  async listKnowledge(): Promise<KnowledgeConcept[]> {
    return (await getConcepts()).map(mapConcept);
  },

  /** Fetch recent completed bars for a symbol (backend → Yahoo Finance) and store them as a dataset. */
  async loadSymbol(symbol: string): Promise<{ datasetId: string; created: boolean }> {
    const d = await request("/datasets/from-symbol", rawDatasetSchema, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }),
    });
    datasetCache.set(d.id, Promise.resolve(d));
    return { datasetId: d.id, created: true };
  },

  getAuthStatus() { return request("/auth/status", rawAuthStatusSchema); },
  login(pin: string) { return request("/auth/login", z.unknown(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) }); },
  logout() { return request("/auth/logout", z.unknown(), { method: "POST" }); },
  /** Runs stop.bat; the backend accepts it only from the host PC. */
  quit() { return request("/app/quit", z.unknown(), { method: "POST" }); },

  getScan() { return request("/scan", rawScanSchema); },
  runScan() { return request("/scan/run", rawScanStatusSchema, { method: "POST" }); },
  setScanAuto(minutes: number) {
    return request("/scan/auto", rawScanStatusSchema, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutes }) });
  },

  getOutcomes() { return request("/outcomes", rawOutcomesSchema); },
  runOutcomes() { return request("/outcomes/run", rawJobStatusSchema, { method: "POST" }); },
  getIntraday() { return request("/intraday", rawIntradaySchema); },
  collectIntraday() { return request("/intraday/collect", rawJobStatusSchema, { method: "POST" }); },

  async uploadDataset(file: File, metadata: Record<string, unknown>): Promise<UploadResult> {
    if (!base()) throw new ApiError("unavailable", "No backend URL configured (NEXT_PUBLIC_API_BASE_URL).", 0);
    const form = new FormData();
    form.append("file", file);
    form.append("metadata", JSON.stringify(metadata));
    let res: Response;
    try { res = await fetch(`${base()}/datasets/upload`, { method: "POST", body: form, credentials: "include", headers: { "X-MSI-Request": "1" } }); }
    catch { throw new ApiError("unavailable", "The analysis service could not be reached.", 0); }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 401) onUnauthorized?.();
    if (!res.ok) {
      return { accepted: false, datasetId: null, issues: [{ code: res.status === 422 ? "rejected" : "http_error", severity: "error", message: detailMessage(body) ?? `Upload failed (${res.status})` }] };
    }
    const parsed = rawDatasetSchema.safeParse(body);
    if (!parsed.success) throw new ApiError("invalid_response", "Upload response does not match the documented contract.", res.status, parsed.error.issues.slice(0, 5));
    const d = parsed.data;
    datasetCache.set(d.id, Promise.resolve(d));
    const issues = mapQuality(d.quality, [], true).issues;
    return { accepted: true, datasetId: d.id, issues: issues.filter((i) => i.code !== "synthetic_data") };
  },
};
