/** HTTP client for the Codex backend (docs/API_CONTRACT.md). Base URL includes the /api/v1 prefix. */
import { z } from "zod";
import type { Analysis, BarsResponse, Instrument, KnowledgeConcept, UploadResult } from "@/types";
import { ApiError } from "../errors";
import { epoch, barsResponse, mapAnalysis, mapConcept, mapDatasetToInstrument, mapQuality, mapSource } from "./mappers";
import {
  rawAnalysisSchema, rawBarSchema, rawConceptSchema, rawDatasetSchema, rawInstrumentsSchema, rawProfileSchema,
  type RawAnalysis, type RawBar, type RawConcept, type RawDataset,
} from "./schemas";

const base = () => (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

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
    res = await fetch(`${base()}${path}`, { ...init, headers: { Accept: "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("unavailable", "The analysis service could not be reached.", 0);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = detailMessage(body) ?? `Request failed (${res.status})`;
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
const conceptMap = async () => new Map((await getConcepts()).map((c) => [c.id, c]));

/** UI cursor times are bar START times; the backend filters on available_at (bar END). */
function asOfIso(bars: RawBar[], asOf: number | undefined): string | undefined {
  if (asOf === undefined) return undefined;
  const bar = bars.find((b) => epoch(b.timestamp) === asOf);
  return bar ? bar.available_at : new Date(asOf * 1000).toISOString();
}

async function snapshotToUi(raw: RawAnalysis, composite: z.infer<typeof rawProfileSchema> | null): Promise<Analysis> {
  const [bars, concepts] = await Promise.all([getAllBars(raw.dataset_id), conceptMap()]);
  return mapAnalysis(raw, { bars, concepts, composite });
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

  async getAnalysis(p: { symbol: string; asOf?: number }): Promise<Analysis> {
    const [d, bars, concepts] = await Promise.all([getDataset(p.symbol), getAllBars(p.symbol), conceptMap()]);
    const as_of = asOfIso(bars, p.asOf);
    let raw: RawAnalysis;
    try {
      raw = await request("/analyze", rawAnalysisSchema, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset_id: p.symbol, ...(as_of ? { as_of } : {}) }) });
    } catch (e) {
      if (e instanceof ApiError && e.code === "rejected") {
        // Domain rejection (no bars at as_of, split suspected, …): the chart stays viewable, analysis is withheld.
        const insufficient = /no completed bars/i.test(e.message);
        return {
          symbol: d.source.instrument, timeframe: `${d.source.timeframe_minutes}m`, session: d.source.session_mode === "regular" ? "RTH" : "ETH",
          asOf: p.asOf ?? epoch(d.last_available_at), generatedAt: d.created_at, source: mapSource(d.source),
          status: insufficient ? "insufficient_data" : "invalid_data", statusMessage: e.message,
          quality: mapQuality(d.quality, bars, true), profiles: {}, valueLocation: null, vsaEvents: [], auctionStates: [], auctionTransitions: [], levels: [], interpretation: null,
        };
      }
      throw e;
    }
    let composite = null;
    try {
      composite = (await request(`/profiles?dataset_id=${encodeURIComponent(p.symbol)}&composite=true${as_of ? `&as_of=${encodeURIComponent(as_of)}` : ""}&bin_size=${raw.parameters["bin_size"] ?? 0.25}`, z.array(rawProfileSchema)))[0] ?? null;
    } catch { /* composite is optional context; its absence is shown as an unavailable profile type */ }
    void concepts;
    return snapshotToUi(raw, composite);
  },

  /** Reopen an immutable persisted snapshot (GET /analyses/{id}). Nothing is recomputed. */
  async getSnapshot(id: string): Promise<Analysis> {
    const raw = await request(`/analyses/${encodeURIComponent(id)}`, rawAnalysisSchema);
    return snapshotToUi(raw, null);
  },

  async listKnowledge(): Promise<KnowledgeConcept[]> {
    return (await getConcepts()).map(mapConcept);
  },

  async uploadDataset(file: File, metadata: Record<string, unknown>): Promise<UploadResult> {
    if (!base()) throw new ApiError("unavailable", "No backend URL configured (NEXT_PUBLIC_API_BASE_URL).", 0);
    const form = new FormData();
    form.append("file", file);
    form.append("metadata", JSON.stringify(metadata));
    let res: Response;
    try { res = await fetch(`${base()}/datasets/upload`, { method: "POST", body: form }); }
    catch { throw new ApiError("unavailable", "The analysis service could not be reached.", 0); }
    const body: unknown = await res.json().catch(() => null);
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
