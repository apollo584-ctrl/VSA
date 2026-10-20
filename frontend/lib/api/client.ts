import type { Analysis, BarsResponse, Instrument, KnowledgeConcept, UploadResult } from "@/types";
import { backendApi } from "./backend/client";
import { ApiError } from "./errors";
import { analysisSchema, barsResponseSchema, instrumentListSchema, knowledgeListSchema, uploadResultSchema } from "./schemas";
import type { z } from "zod";

export type ApiMode = "mock" | "http";

function scanBackend() {
  if (API_MODE === "mock") throw new ApiError("not_supported", "The scanner needs the real backend; mock mode has no market data.", 0);
  return backendApi;
}

/** "mock": deterministic synthetic fixtures. "http": the Codex backend (docs/API_CONTRACT.md). */
export const API_MODE: ApiMode =
  (process.env.NEXT_PUBLIC_API_MODE as ApiMode | undefined) ?? (process.env.NODE_ENV === "development" ? "mock" : "http");
/** Base URL including the /api/v1 prefix, e.g. http://127.0.0.1:8000/api/v1 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export interface BarsParams { symbol: string; timeframe: string; session: string; to?: number; limit?: number }
export interface AnalysisParams { symbol: string; timeframe: string; session: string; asOf?: number; persist?: boolean }

async function mock() {
  return (await import("@/fixtures/api")).mockApi;
}

/** Validate every response (mock or real) against the UI's internal schemas, so neither can drift silently. */
function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ApiError("invalid_response", "Response does not match the expected shape.", 0, r.error.issues.slice(0, 5));
  return r.data;
}

export const api = {
  async listInstruments(q?: string): Promise<Instrument[]> {
    const items = API_MODE === "mock" ? await (await mock()).listInstruments(q) : await backendApi.listInstruments(q);
    return validated(instrumentListSchema, { instruments: items }).instruments;
  },

  async getBars(p: BarsParams): Promise<BarsResponse> {
    return validated(barsResponseSchema, API_MODE === "mock" ? await (await mock()).getBars(p) : await backendApi.getBars(p));
  },

  async getAnalysis(p: AnalysisParams): Promise<Analysis> {
    return validated(analysisSchema, API_MODE === "mock" ? await (await mock()).getAnalysis(p) : await backendApi.getAnalysis(p));
  },

  /** Reopen a persisted, immutable analysis snapshot. */
  async getSnapshot(id: string): Promise<Analysis> {
    if (API_MODE === "mock") throw new ApiError("not_supported", "Saved snapshots are only available with the real backend.", 0);
    return validated(analysisSchema, await backendApi.getSnapshot(id));
  },

  async listKnowledge(): Promise<KnowledgeConcept[]> {
    const items = API_MODE === "mock" ? await (await mock()).listKnowledge() : await backendApi.listKnowledge();
    return validated(knowledgeListSchema, { concepts: items }).concepts;
  },

  /** Load recent bars for a typed symbol. Only the real backend can fetch market data. */
  async loadSymbol(symbol: string): Promise<{ datasetId: string }> {
    if (API_MODE === "mock") throw new ApiError("not_supported", "Loading a symbol needs the real backend; mock mode uses fixed fixtures.", 0);
    const { datasetId } = await backendApi.loadSymbol(symbol);
    return { datasetId };
  },

  /** Scanner calls need the real backend: they fetch live market data. */
  async getScan() { return scanBackend().getScan(); },
  async runScan() { return scanBackend().runScan(); },
  async setScanAuto(minutes: number) { return scanBackend().setScanAuto(minutes); },

  async getOutcomes() { return scanBackend().getOutcomes(); },
  async runOutcomes() { return scanBackend().runOutcomes(); },
  async getIntraday() { return scanBackend().getIntraday(); },
  async collectIntraday() { return scanBackend().collectIntraday(); },

  async uploadDataset(file: File, metadata: Record<string, unknown>): Promise<UploadResult> {
    if (API_MODE === "mock") return validated(uploadResultSchema, await (await mock()).uploadDataset({ name: file.name, text: await file.text() }));
    return validated(uploadResultSchema, await backendApi.uploadDataset(file, metadata));
  },
};
