/**
 * MOCK TRANSPORT — implements the same operations as the HTTP client, backed by synthetic fixtures.
 * Loaded only when NEXT_PUBLIC_API_MODE=mock. Deterministic; adds small latency to exercise loading states.
 */
import type { Analysis, BarsResponse, Instrument, KnowledgeConcept, UploadResult } from "@/types";
import { BARS_PER_SESSION, SESSION_DATES, buildFixA, buildFixB, buildFixC, toDaily } from "./bars";
import { MOCK_SOURCE, analyse, barQuality, type InstrumentScript } from "./engine";
import { KNOWLEDGE_FIXTURES } from "./knowledge";
import { ApiError } from "@/lib/api/errors";

const S = (s: number, i: number): [number, number] => [s, i];

const SCRIPT_A: InstrumentScript = {
  events: [
    { type: "stopping_volume", at: S(6, 4), resolve: { status: "confirmed", afterBars: 3, reason: "Low-volume retest held above the event low." } },
    { type: "shakeout", at: S(6, 6), resolve: { status: "confirmed", afterBars: 4, reason: "Price rotated back through the prior value area." } },
    { type: "no_demand", at: S(10, 7), resolve: { status: "invalidated", afterBars: 6, reason: "Price extended higher on rising volume." } },
    { type: "upthrust", at: S(12, 8) },
  ],
  states: [
    { kind: "balance", start: S(0, 0), end: S(6, 3), detected: S(1, 12), summary: "Overlapping value areas across sessions; range edges rejected." },
    { kind: "breakout_attempt", start: S(6, 3), end: S(6, 6), detected: S(6, 4), summary: "Price moved below the balance low on rising volume." },
    { kind: "failed_auction", start: S(6, 6), end: S(6, 9), detected: S(6, 7), summary: "Lower prices were not accepted; price returned inside the prior range." },
    { kind: "value_migration", start: S(6, 9), end: S(9, 0), detected: S(7, 10), summary: "Session value areas stepping higher with limited overlap." },
    { kind: "trend_development", start: S(9, 0), end: S(10, 0), detected: S(9, 4), summary: "Persistent directional movement with shallow pullbacks." },
    { kind: "balance", start: S(10, 0), end: S(11, 3), detected: S(10, 10), summary: "Narrow rotation at higher prices on reduced volume." },
    { kind: "breakout_attempt", start: S(11, 3), end: S(11, 8), detected: S(11, 4), summary: "Price trading above the prior value area high." },
    { kind: "acceptance", start: S(11, 8), end: S(12, 8), detected: S(12, 0), summary: "Time and volume have built above the prior value area; value is establishing higher." },
    { kind: "rejection", start: S(12, 8), end: null, detected: S(12, 8), summary: "A high-volume probe above the morning high closed near its low (local rejection; unresolved)." },
  ],
};

const SCRIPT_B: InstrumentScript = {
  events: [],
  states: [{ kind: "balance", start: S(0, 0), end: null, detected: S(1, 12), summary: "Orderly two-sided rotation; overlapping value across all sessions." }],
};

interface MockInstrument {
  meta: Instrument;
  bars: ReturnType<typeof buildFixA>;
  script: InstrumentScript;
}

let cache: Record<string, MockInstrument> | null = null;

function data(): Record<string, MockInstrument> {
  if (cache) return cache;
  const mk = (symbol: string, name: string, bars: ReturnType<typeof buildFixA>, script: InstrumentScript, dates: string[]): MockInstrument => ({
    meta: { symbol, name, exchange: "SYNTH", timeframes: ["30m", "1D"], sessions: ["RTH"], availableDates: dates, source: MOCK_SOURCE },
    bars, script,
  });
  cache = {
    FIXA: mk("FIXA", "Fixture A — advance with late upthrust (synthetic)", buildFixA(), SCRIPT_A, SESSION_DATES),
    FIXB: mk("FIXB", "Fixture B — orderly balance, no patterns (synthetic)", buildFixB(), SCRIPT_B, SESSION_DATES),
    FIXC: mk("FIXC", "Fixture C — insufficient data (synthetic)", buildFixC(), { events: [], states: [] }, [SESSION_DATES[12]!]),
  };
  return cache;
}

const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));

function get(symbol: string): MockInstrument {
  const inst = data()[symbol.toUpperCase()];
  if (!inst) throw new ApiError("not_found", `Unknown instrument "${symbol}"`, 404);
  return inst;
}

/** Index of the last bar whose open time ≤ asOf (unix seconds). */
export function indexAtOrBefore(times: number[], asOf: number): number {
  let lo = 0, hi = times.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= asOf) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export const mockApi = {
  async listInstruments(q?: string): Promise<Instrument[]> {
    await delay(120);
    const all = Object.values(data()).map((d) => d.meta);
    const needle = q?.trim().toLowerCase();
    return needle ? all.filter((i) => i.symbol.toLowerCase().includes(needle) || i.name.toLowerCase().includes(needle)) : all;
  },

  async getBars(p: { symbol: string; timeframe: string; session: string; to?: number; limit?: number }): Promise<BarsResponse> {
    await delay();
    const inst = get(p.symbol);
    let bars = p.timeframe === "1D" ? toDaily(inst.bars) : inst.bars;
    if (p.to !== undefined) bars = bars.filter((b) => b.t <= p.to!);
    if (p.limit) bars = bars.slice(-p.limit);
    return {
      symbol: inst.meta.symbol, timeframe: p.timeframe, session: p.session, source: MOCK_SOURCE,
      generatedAt: new Date(Date.UTC(2026, 9, 14)).toISOString(), bars, quality: barQuality(bars),
    };
  },

  async getAnalysis(p: { symbol: string; timeframe: string; session: string; asOf?: number }): Promise<Analysis> {
    await delay(300);
    const inst = get(p.symbol);
    const times = inst.bars.map((b) => b.t);
    const k = p.asOf === undefined ? inst.bars.length - 1 : indexAtOrBefore(times, p.asOf);
    if (k < 0) throw new ApiError("no_data", "No bars at or before the requested asOf", 404);
    return analyse(inst.meta.symbol, inst.bars, k, inst.script, p.timeframe, p.session);
  },

  async listKnowledge(): Promise<KnowledgeConcept[]> {
    await delay(150);
    return KNOWLEDGE_FIXTURES;
  },

  async uploadDataset(file: { name: string; text: string }): Promise<UploadResult> {
    await delay(400);
    const header = file.text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
    const required = ["time", "open", "high", "low", "close", "volume"];
    const missing = required.filter((c) => !header.includes(c));
    if (missing.length) {
      return { accepted: false, datasetId: null, issues: [{ code: "missing_columns", severity: "error", message: `Missing required column(s): ${missing.join(", ")}.` }] };
    }
    return {
      accepted: false, datasetId: null,
      issues: [{ code: "mock_mode", severity: "error", message: "Mock mode cannot ingest datasets. Connect the backend (NEXT_PUBLIC_API_MODE=http) to upload." }],
    };
  },
};

export type MockApi = typeof mockApi;
export { BARS_PER_SESSION };
