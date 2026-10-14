import { z } from "zod";
import type { Analysis, BarsResponse, Instrument, KnowledgeConcept, UploadResult } from "@/types";
import { ApiError } from "./errors";
import {
  analysisSchema, apiErrorSchema, barsResponseSchema, instrumentListSchema, knowledgeListSchema, uploadResultSchema,
} from "./schemas";

export type ApiMode = "mock" | "http";

export const API_MODE: ApiMode =
  (process.env.NEXT_PUBLIC_API_MODE as ApiMode | undefined) ?? (process.env.NODE_ENV === "development" ? "mock" : "http");
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export interface BarsParams { symbol: string; timeframe: string; session: string; to?: number; limit?: number }
export interface AnalysisParams { symbol: string; timeframe: string; session: string; asOf?: number }

async function http<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  if (!API_BASE) throw new ApiError("unavailable", "No backend URL configured (NEXT_PUBLIC_API_BASE_URL).", 0);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers: { Accept: "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("unavailable", "The analysis service could not be reached.", 0);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiError(parsed.success ? parsed.data.error.code : "http_error", parsed.success ? parsed.data.error.message : `Request failed (${res.status})`, res.status);
  }
  const out = schema.safeParse(body);
  if (!out.success) {
    throw new ApiError("invalid_response", "The service returned data that does not match the expected contract.", res.status, out.error.issues.slice(0, 5));
  }
  return out.data;
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

async function mock() {
  return (await import("@/fixtures/api")).mockApi;
}

/** Validate mock output through the same schemas so fixtures cannot drift from the contract. */
async function validated<T>(schema: z.ZodType<T>, value: unknown): Promise<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new ApiError("invalid_response", "Fixture does not match schema", 0, r.error.issues.slice(0, 5));
  return r.data;
}

export const api = {
  async listInstruments(q?: string): Promise<Instrument[]> {
    if (API_MODE === "mock") return (await validated(instrumentListSchema, { instruments: await (await mock()).listInstruments(q) })).instruments;
    return (await http(`/api/v1/instruments${qs({ q })}`, instrumentListSchema)).instruments;
  },

  async getBars(p: BarsParams): Promise<BarsResponse> {
    if (API_MODE === "mock") return validated(barsResponseSchema, await (await mock()).getBars(p));
    return http(`/api/v1/instruments/${encodeURIComponent(p.symbol)}/bars${qs({ timeframe: p.timeframe, session: p.session, to: p.to, limit: p.limit })}`, barsResponseSchema);
  },

  async getAnalysis(p: AnalysisParams): Promise<Analysis> {
    if (API_MODE === "mock") return validated(analysisSchema, await (await mock()).getAnalysis(p));
    return http(`/api/v1/instruments/${encodeURIComponent(p.symbol)}/analysis${qs({ timeframe: p.timeframe, session: p.session, asOf: p.asOf })}`, analysisSchema);
  },

  async listKnowledge(): Promise<KnowledgeConcept[]> {
    if (API_MODE === "mock") return (await validated(knowledgeListSchema, { concepts: await (await mock()).listKnowledge() })).concepts;
    return (await http("/api/v1/knowledge", knowledgeListSchema)).concepts;
  },

  async uploadDataset(file: File): Promise<UploadResult> {
    if (API_MODE === "mock") return validated(uploadResultSchema, await (await mock()).uploadDataset({ name: file.name, text: await file.text() }));
    const form = new FormData();
    form.append("file", file);
    return http("/api/v1/datasets", uploadResultSchema, { method: "POST", body: form });
  },
};
