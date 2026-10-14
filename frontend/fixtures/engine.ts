/**
 * MOCK ENGINE — stands in for the Codex backend while it is under development.
 *
 * It exists ONLY to produce API-shaped responses from deterministic synthetic bars so the UI can be exercised.
 * It is intentionally simple, is never imported by production UI code paths (only by fixtures/api.ts, which is
 * loaded when NEXT_PUBLIC_API_MODE=mock), and must not be treated as analytical truth.
 */
import type {
  Analysis, AuctionState, AuctionTransition, Bar, DataQuality, DatasetSource, DetectionStatus, EvidenceItem, Interpretation,
  Level, Profile, ProfileKind, VsaEvent, VsaPatternType,
} from "@/types";
import { BARS_PER_SESSION } from "./bars";

export const MOCK_SOURCE: DatasetSource = {
  name: "Synthetic fixture",
  kind: "fixture",
  provider: "frontend/fixtures",
  note: "Deterministic synthetic bars for UI development. Not market data.",
};

const f2 = (n: number) => n.toFixed(2);

// ---------------------------------------------------------------- profile

function niceBin(price: number): number {
  const raw = price * 0.0025;
  const steps = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];
  return steps.find((s) => s >= raw) ?? 1;
}

interface RawProfile {
  bins: { price: number; tpo: number; volume: number }[];
  binSize: number;
  poc: number;
  vah: number;
  val: number;
}

function buildBins(bars: Bar[], binSize: number, weight: "tpo" | "volume"): RawProfile | null {
  if (!bars.length) return null;
  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const start = Math.floor(lo / binSize) * binSize;
  const n = Math.max(1, Math.ceil((hi - start) / binSize));
  const bins = Array.from({ length: n }, (_, i) => ({ price: +(start + (i + 0.5) * binSize).toFixed(4), tpo: 0, volume: 0 }));
  for (const b of bars) {
    const a = Math.max(0, Math.floor((b.l - start) / binSize));
    const z = Math.min(n - 1, Math.floor((b.h - start) / binSize));
    const count = z - a + 1;
    for (let i = a; i <= z; i++) {
      bins[i]!.tpo += 1;
      bins[i]!.volume += b.v / count;
    }
  }
  const w = (i: number) => bins[i]![weight];
  let pocIdx = 0;
  for (let i = 1; i < n; i++) if (w(i) > w(pocIdx)) pocIdx = i;
  const total = bins.reduce((a, b) => a + b[weight], 0);
  let lowI = pocIdx, highI = pocIdx, acc = w(pocIdx);
  while (acc < total * 0.7 && (lowI > 0 || highI < n - 1)) {
    const up = highI < n - 1 ? w(highI + 1) + (highI + 2 < n ? w(highI + 2) : 0) : -1;
    const dn = lowI > 0 ? w(lowI - 1) + (lowI - 2 >= 0 ? w(lowI - 2) : 0) : -1;
    if (up >= dn) { highI = Math.min(n - 1, highI + 2); acc += up; }
    else { lowI = Math.max(0, lowI - 2); acc += dn; }
  }
  return { bins, binSize, poc: bins[pocIdx]!.price, vah: Math.min(hi, bins[highI]!.price + binSize / 2), val: Math.max(lo, bins[lowI]!.price - binSize / 2) };
}

function nodes(bins: RawProfile["bins"], weight: "tpo" | "volume") {
  const vals = bins.map((b) => b[weight]);
  const sm = vals.map((_, i) => ((vals[i - 1] ?? vals[i]!) + vals[i]! + (vals[i + 1] ?? vals[i]!)) / 3);
  const max = Math.max(...sm);
  const peaks: number[] = [];
  for (let i = 0; i < sm.length; i++) {
    let isPeak = sm[i]! >= max * 0.6;
    for (let d = -2; d <= 2 && isPeak; d++) if (d && sm[i + d] !== undefined && sm[i + d]! > sm[i]!) isPeak = false;
    if (isPeak && (!peaks.length || i - peaks[peaks.length - 1]! > 2)) peaks.push(i);
  }
  const lvns: number[] = [];
  for (let p = 0; p + 1 < peaks.length; p++) {
    let m = peaks[p]!;
    for (let i = peaks[p]!; i <= peaks[p + 1]!; i++) if (sm[i]! < sm[m]!) m = i;
    if (sm[m]! <= Math.min(sm[peaks[p]!]!, sm[peaks[p + 1]!]!) * 0.65) lvns.push(m);
  }
  return { peaks, lvns };
}

function sessionBars(bars: Bar[], s: number, upTo: number): Bar[] {
  return bars.slice(s * BARS_PER_SESSION, Math.min(upTo + 1, (s + 1) * BARS_PER_SESSION));
}

function dateOf(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

export function makeProfile(kind: ProfileKind, slice: Bar[], allBars: Bar[], k: number, label: string): Profile | null {
  if (slice.length < 1) return null;
  const weight = kind === "tpo" ? "tpo" : "volume";
  const binSize = niceBin(slice[0]!.c);
  const raw = buildBins(slice, binSize, weight);
  if (!raw) return null;
  const { peaks, lvns } = nodes(raw.bins, weight);
  const lo = Math.min(...slice.map((b) => b.l));
  const hi = Math.max(...slice.map((b) => b.h));
  const range = hi - lo || binSize;
  const pocFrac = (raw.poc - lo) / range;
  const rationale: string[] = [];
  let type: Profile["shape"]["type"] = "undetermined";
  let confidence = 0.35;
  let distributions: Profile["shape"]["distributions"] = [];
  const drift = Math.abs(slice[slice.length - 1]!.c - slice[0]!.o);

  if (slice.length < 4) {
    rationale.push(`Only ${slice.length} bars contribute — shape is not yet determinable.`);
  } else if (peaks.length >= 3 && lvns.length >= 2) {
    type = "multi"; confidence = 0.55;
    rationale.push(`${peaks.length} distinct volume peaks separated by ${lvns.length} low-volume nodes.`);
    distributions = peaks.map((p, i) => ({ low: raw.bins[Math.max(0, i === 0 ? 0 : Math.round(((lvns[i - 1] ?? p) + p) / 2))]!.price, high: raw.bins[Math.min(raw.bins.length - 1, i === peaks.length - 1 ? raw.bins.length - 1 : Math.round((p + (lvns[i] ?? p)) / 2))]!.price, poc: raw.bins[p]!.price, label: `Distribution ${i + 1}` }));
  } else if (peaks.length === 2 && lvns.length >= 1) {
    type = "B"; confidence = 0.6;
    const split = raw.bins[lvns[0]!]!.price;
    rationale.push(`Two volume peaks (${f2(raw.bins[peaks[0]!]!.price)} and ${f2(raw.bins[peaks[1]!]!.price)}) separated by a low-volume node near ${f2(split)}.`);
    distributions = [
      { low: lo, high: split, poc: raw.bins[peaks[0]!]!.price, label: "Lower distribution" },
      { low: split, high: hi, poc: raw.bins[peaks[1]!]!.price, label: "Upper distribution" },
    ];
  } else if (kind === "composite" && drift > range * 0.6) {
    type = "trend"; confidence = 0.6;
    rationale.push(`Net displacement (${f2(drift)}) is ${Math.round((drift / range) * 100)}% of the composite range.`);
  } else {
    distributions = [{ low: raw.val, high: raw.vah, poc: raw.poc, label: "Value area" }];
    if (pocFrac > 0.62) type = "P";
    else if (pocFrac < 0.38) type = "b";
    else type = "D";
    confidence = 0.4 + Math.min(0.4, Math.abs(pocFrac - 0.5));
    rationale.push(`POC (${f2(raw.poc)}) sits at ${Math.round(pocFrac * 100)}% of the profile range (${f2(lo)}–${f2(hi)}).`);
  }
  const slugByType: Record<string, string | null> = { D: "profile-shape-d", P: "profile-shape-p", b: "profile-shape-b", B: "profile-shape-double", trend: "profile-shape-trend", multi: "profile-shape-multi", undetermined: null };

  const hvns = peaks.map((p) => raw.bins[p]!.price);
  const lvnPrices = lvns.map((i) => raw.bins[i]!.price);
  const sIdx = Math.floor(k / BARS_PER_SESSION);
  const migration: Profile["valueMigration"] = [];
  for (let s = Math.max(0, sIdx - 7); s <= sIdx; s++) {
    const sb = sessionBars(allBars, s, k);
    const r = buildBins(sb, niceBin(sb[0]?.c ?? 100), "volume");
    if (r) migration.push({ date: dateOf(sb[0]!.t), poc: r.poc, vah: r.vah, val: r.val });
  }
  const first = slice[0]!;
  const ibBars = slice.filter((b) => b.t < first.t + 2 * 1800).length >= 2 ? slice.slice(0, 2) : null;

  return {
    kind,
    estimated: true,
    estimationMethod: kind === "tpo"
      ? "TPO counts derived from 30-minute bar high/low ranges (one count per bar per price bin)"
      : "Volume apportioned uniformly across each bar's high–low range (OHLCV estimate; not traded volume-at-price)",
    label,
    startTime: first.t,
    endTime: slice[slice.length - 1]!.t,
    binSize,
    bins: raw.bins,
    poc: raw.poc, vah: raw.vah, val: raw.val,
    hvns, lvns: lvnPrices,
    sessionHigh: hi, sessionLow: lo,
    initialBalance: ibBars ? { high: Math.max(...ibBars.map((b) => b.h)), low: Math.min(...ibBars.map((b) => b.l)) } : null,
    shape: { type, confidence: null, ambiguity: confidence >= 0.6 ? "low" : "high", knowledgeSlug: slugByType[type] ?? null, distributions, rationale },
    valueMigration: migration,
  };
}

function developingTrack(allBars: Bar[], s: number, k: number) {
  const out: NonNullable<Profile["developingTrack"]> = [];
  const sb = sessionBars(allBars, s, k);
  for (let j = 0; j < sb.length; j++) {
    const r = buildBins(sb.slice(0, j + 1), niceBin(sb[0]!.c), "volume");
    if (r) out.push({ time: sb[j]!.t, poc: r.poc, vah: r.vah, val: r.val });
  }
  return out;
}

// ---------------------------------------------------------------- events (scripted positions, computed measurements)

interface EventScript {
  type: VsaPatternType;
  at: [number, number]; // [session, bar]
  resolve?: { status: DetectionStatus; afterBars: number; reason: string };
}

interface AuctionScript {
  kind: AuctionState["kind"];
  start: [number, number];
  end: [number, number] | null;
  detected: [number, number];
  summary: string;
}

export interface InstrumentScript {
  events: EventScript[];
  states: AuctionScript[];
}

const gi = (p: [number, number]) => p[0] * BARS_PER_SESSION + p[1];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function measure(bars: Bar[], i: number) {
  const b = bars[i]!;
  const prior = bars.slice(Math.max(0, i - 20), i);
  const spread = b.h - b.l;
  const avgSpread = mean(prior.map((x) => x.h - x.l)) || spread;
  const avgVol = mean(prior.map((x) => x.v)) || b.v;
  const back = bars[Math.max(0, i - 13)]!;
  const chg = (b.o - back.c) / back.c;
  return {
    spread: +spread.toFixed(2),
    spreadVsAvg: +(spread / avgSpread).toFixed(2),
    relativeVolume: +(b.v / avgVol).toFixed(2),
    closeLocation: +Math.min(1, Math.max(0, spread ? (b.c - b.l) / spread : 0.5)).toFixed(2),
    priorTrend: (chg > 0.01 ? "up" : chg < -0.01 ? "down" : "sideways") as "up" | "down" | "sideways",
  };
}

function locationText(price: number, ref: Profile | null): string {
  if (!ref) return "No prior-session value area available";
  if (price > ref.vah) return `Above prior-session value (VAH ${f2(ref.vah)})`;
  if (price < ref.val) return `Below prior-session value (VAL ${f2(ref.val)})`;
  return `Inside prior-session value (${f2(ref.val)}–${f2(ref.vah)})`;
}

function buildEvent(script: EventScript, bars: Bar[], k: number, priorProfile: Profile | null): VsaEvent | null {
  const i = gi(script.at);
  if (i > k) return null; // no look-ahead: unknown before its bar completes
  const b = bars[i]!;
  const m = measure(bars, i);
  const measurements = { ...m, priceLocation: locationText(b.c, priorProfile) };
  const history: VsaEvent["statusHistory"] = [{ status: "provisional", at: b.t, reason: "Bar completed; later bars not yet seen." }];
  if (script.resolve) {
    const ri = i + script.resolve.afterBars;
    if (ri <= k) history.push({ status: script.resolve.status, at: bars[ri]!.t, reason: script.resolve.reason });
  }
  if (k - i >= 2 * BARS_PER_SESSION && history.length > 1) history.push({ status: "historical", at: bars[i + 2 * BARS_PER_SESSION]!.t, reason: "Older than two sessions; retained as a historical observation." });
  const status = history[history.length - 1]!.status;
  const t = template(script.type, m, b, bars, i, priorProfile);
  return {
    id: `${script.type}-${b.t}`,
    type: script.type,
    barTime: b.t,
    detectedAt: b.t,
    status,
    statusHistory: history,
    measurements,
    ...t,
  };
}

function template(type: VsaPatternType, m: ReturnType<typeof measure>, b: Bar, bars: Bar[], i: number, ref: Profile | null) {
  const prevHigh = Math.max(...bars.slice(Math.max(0, i - 8), i).map((x) => x.h));
  const prevLow = Math.min(...bars.slice(Math.max(0, i - 8), i).map((x) => x.l));
  const vahRef = ref ? [ref.vah] : [];
  switch (type) {
    case "upthrust":
      return {
        conditions: [
          { label: "Probe above recent range", met: b.h > prevHigh, detail: `High ${f2(b.h)} vs prior 8-bar high ${f2(prevHigh)}` },
          { label: "Close in lower part of the bar", met: m.closeLocation < 0.4, detail: `Close location ${m.closeLocation.toFixed(2)} (0 = low, 1 = high)` },
          { label: "Elevated relative volume", met: m.relativeVolume >= 1.5, detail: `${m.relativeVolume.toFixed(2)}× the 20-bar average` },
          { label: "Spread wider than typical", met: m.spreadVsAvg >= 1.2, detail: `${m.spreadVsAvg.toFixed(2)}× the 20-bar average spread` },
        ],
        implications: [
          "Higher prices were offered and the bar finished well off its high, which is one way a local rejection of the probe can appear.",
          "If sellers or profit-taking were absorbing demand at the highs, price may struggle to hold above the probed area (hypothesis, not observation).",
        ],
        alternatives: [
          "High volume on a wide bar can also reflect two-sided participation in a strong advance, with no change in direction.",
          "A single bar's close location is sensitive to the bar interval; the same activity on a different timeframe may look different.",
          "News or a scheduled event may explain the spike independent of auction structure.",
        ],
        confirmation: ["Subsequent bars close below the upthrust bar's midpoint without recovering its high.", "Price re-enters the prior value area and is accepted there (multiple bars/TPOs)."],
        invalidation: ["Price closes above the upthrust high on comparable or rising volume.", "Time and volume build at prices above the upthrust bar's range (acceptance)."],
        profileRefs: ["session_high", "vah"] as VsaEvent["profileRefs"],
        referencePrices: [b.h, ...vahRef],
        knowledgeSlugs: ["vsa-upthrust", "auction-acceptance-vs-excursion", "auction-failed-auction"],
      };
    case "shakeout":
      return {
        conditions: [
          { label: "Probe below recent range", met: b.l < prevLow, detail: `Low ${f2(b.l)} vs prior 8-bar low ${f2(prevLow)}` },
          { label: "Close recovered into the bar's upper half", met: m.closeLocation >= 0.5, detail: `Close location ${m.closeLocation.toFixed(2)}` },
          { label: "Elevated relative volume", met: m.relativeVolume >= 1.5, detail: `${m.relativeVolume.toFixed(2)}× the 20-bar average` },
        ],
        implications: ["Price moved below the recent range and was quickly returned, which may indicate that lower prices were not accepted (one possible reading).", "If lower prices attracted responsive buying, the move below balance may be a failed downside excursion (hypothesis)."],
        alternatives: ["Stop-run activity and genuine accumulation are not distinguishable from OHLCV alone.", "A rebound may fade if it lacks follow-through; one bar is a thin basis for inference."],
        confirmation: ["Subsequent bars hold above the shakeout bar's midpoint.", "Price rotates back through the prior value area."],
        invalidation: ["Price closes back below the shakeout low.", "Rallies are repeatedly sold on rising volume."],
        profileRefs: ["val", "session_low"] as VsaEvent["profileRefs"],
        referencePrices: [b.l],
        knowledgeSlugs: ["vsa-shakeout", "auction-failed-auction"],
      };
    case "stopping_volume":
      return {
        conditions: [
          { label: "Prior decline", met: m.priorTrend !== "up", detail: `Prior trend: ${m.priorTrend}` },
          { label: "Very high relative volume", met: m.relativeVolume >= 2, detail: `${m.relativeVolume.toFixed(2)}× the 20-bar average` },
          { label: "Close off the low", met: m.closeLocation > 0.3, detail: `Close location ${m.closeLocation.toFixed(2)}` },
        ],
        implications: ["Heavy volume with a close away from the low may mean the decline met substantial opposing orders at that point (hypothesis).", "It marks effort without a proportionate downward result, which is why it is studied as a possible slowing of the decline."],
        alternatives: ["High volume during a decline can precede continuation if the opposing orders are exhausted.", "Index rebalancing or option-expiry effects can create high volume unrelated to directional intent."],
        confirmation: ["A subsequent test on lower volume that holds above the low.", "Price closes above the bar's high."],
        invalidation: ["Price trades and closes below the bar's low on expanding volume."],
        profileRefs: ["session_low", "lvn"] as VsaEvent["profileRefs"],
        referencePrices: [b.l],
        knowledgeSlugs: ["vsa-stopping-volume", "vsa-test-of-supply"],
      };
    case "no_demand":
      return {
        conditions: [
          { label: "Up bar with narrow spread", met: m.spreadVsAvg < 0.8, detail: `${m.spreadVsAvg.toFixed(2)}× the 20-bar average spread` },
          { label: "Low relative volume", met: m.relativeVolume < 0.7, detail: `${m.relativeVolume.toFixed(2)}× the 20-bar average` },
          { label: "Close not near the high", met: m.closeLocation < 0.8, detail: `Close location ${m.closeLocation.toFixed(2)}` },
        ],
        implications: ["An advance on little volume and a small range may indicate weak participation in the upward move (hypothesis).", "It describes lack of follow-through buying; it does not by itself show sellers are present."],
        alternatives: ["Quiet bars in a lunch-time lull are normal and may carry no information.", "In a healthy balance, low-volume drifts toward the edges often occur before larger moves in either direction."],
        confirmation: ["Subsequent bars fail to extend higher and volume expands on declines."],
        invalidation: ["Price extends higher on rising volume."],
        profileRefs: ["poc"] as VsaEvent["profileRefs"],
        referencePrices: [b.c],
        knowledgeSlugs: ["vsa-no-demand"],
      };
    default:
      return { conditions: [], implications: [], alternatives: [], confirmation: [], invalidation: [], profileRefs: [] as VsaEvent["profileRefs"], referencePrices: [b.c], knowledgeSlugs: [] };
  }
}

// ---------------------------------------------------------------- auction

function buildAuction(script: AuctionScript[], bars: Bar[], k: number) {
  const states: AuctionState[] = [];
  const transitions: AuctionTransition[] = [];
  script.forEach((sc, n) => {
    const det = gi(sc.detected);
    if (det > k) return;
    const s = gi(sc.start);
    const eIdx = sc.end ? gi(sc.end) : null;
    const endsKnown = eIdx !== null && eIdx <= k;
    const rangeBars = bars.slice(s, Math.min((endsKnown ? eIdx! : k) + 1, bars.length));
    const id = `state-${n + 1}`;
    states.push({
      id, kind: sc.kind,
      startTime: bars[s]!.t,
      endTime: endsKnown ? bars[eIdx!]!.t : null,
      detectedAt: bars[det]!.t,
      priceLow: rangeBars.length ? Math.min(...rangeBars.map((b) => b.l)) : undefined,
      priceHigh: rangeBars.length ? Math.max(...rangeBars.map((b) => b.h)) : undefined,
      summary: sc.summary,
    });
    const prev = states.length > 1 ? states[states.length - 2]! : null;
    const startBar = bars[s]!;
    const evidence: EvidenceItem[] = [
      { id: `${id}-e1`, kind: "price_action", text: `State begins at ${f2(startBar.c)} close.`, at: startBar.t },
      { id: `${id}-e2`, kind: "structure", text: `Range during state so far: ${rangeBars.length ? `${f2(Math.min(...rangeBars.map((b) => b.l)))}–${f2(Math.max(...rangeBars.map((b) => b.h)))}` : "n/a"}.`, measurement: `${rangeBars.length} bars` },
      { id: `${id}-e3`, kind: "volume", text: `Average volume in range ${Math.round(mean(rangeBars.map((b) => b.v))).toLocaleString()} per bar vs ${Math.round(mean(bars.slice(0, k + 1).map((b) => b.v))).toLocaleString()} overall.` },
    ];
    transitions.push({
      id: `tr-${n + 1}`,
      fromStateId: prev?.id ?? null,
      toStateId: id,
      at: startBar.t,
      detectedAt: bars[det]!.t,
      rationale: sc.summary,
      evidence,
    });
  });
  return { states, transitions };
}

// ---------------------------------------------------------------- levels

function buildLevels(prior: Profile | null, priorBars: Bar[], current: Profile | null, composite: Profile | null): Level[] {
  const out: Level[] = [];
  if (prior) {
    out.push(
      { id: "prior_vah", kind: "prior_vah", price: prior.vah, label: "Prior VAH", note: "Value area high of the previous session (estimated profile)." },
      { id: "prior_val", kind: "prior_val", price: prior.val, label: "Prior VAL", note: "Value area low of the previous session (estimated profile)." },
      { id: "prior_poc", kind: "prior_poc", price: prior.poc, label: "Prior POC" },
    );
    if (priorBars.length) {
      out.push({ id: "prior_high", kind: "prior_high", price: Math.max(...priorBars.map((b) => b.h)), label: "Prior high" }, { id: "prior_low", kind: "prior_low", price: Math.min(...priorBars.map((b) => b.l)), label: "Prior low" });
    }
  }
  if (current?.initialBalance) out.push({ id: "ib_high", kind: "ib_high", price: current.initialBalance.high, label: "IB high" }, { id: "ib_low", kind: "ib_low", price: current.initialBalance.low, label: "IB low" });
  composite?.hvns.slice(0, 3).forEach((p, i) => out.push({ id: `hvn-${i}`, kind: "hvn", price: p, label: "HVN" }));
  composite?.lvns.slice(0, 3).forEach((p, i) => out.push({ id: `lvn-${i}`, kind: "lvn", price: p, label: "LVN" }));
  return out;
}

// ---------------------------------------------------------------- interpretation

function nar(quick: string, standard: string, deep: string[]) { return { quick, standard, deep }; }

function interpret(ctx: {
  bars: Bar[]; k: number; current: Profile; prior: Profile | null; events: VsaEvent[]; states: AuctionState[]; location: Analysis["valueLocation"];
}): Interpretation {
  const { bars, k, current, prior, events, states, location } = ctx;
  const last = bars[k]!;
  const recent = events.filter((e) => e.barTime >= bars[Math.max(0, k - 4)]!.t && e.status !== "invalidated");
  const ev = recent[recent.length - 1] ?? null;
  const state = states[states.length - 1] ?? null;
  const shape = current.shape.type;
  const sessionBarsN = (k % BARS_PER_SESSION) + 1;
  const rel = location?.relativeTo ?? "unknown";
  const stateName = state ? state.kind.replace(/_/g, " ") : "undetermined";
  const supporting: EvidenceItem[] = [];
  const contradicting: EvidenceItem[] = [];
  let scenarios: Interpretation["scenarios"] = [];
  let watch: Interpretation["watchNext"] = [];
  let balance: Interpretation["evidenceBalance"] = "consistent";

  const priorTxt = prior ? `prior-session value ${f2(prior.val)}–${f2(prior.vah)}` : "no prior session available";
  const posTxt = rel === "above_value" ? "above" : rel === "below_value" ? "below" : rel === "inside_value" ? "inside" : "unclassified relative to";

  supporting.push({ id: "ev-profile", kind: "profile", text: `Current session profile is classified ${shape === "undetermined" ? "undetermined" : `${shape}-shaped`} with POC ${f2(current.poc)}.`, measurement: `${current.shape.ambiguity ?? "unknown"} ambiguity` });
  if (rel !== "unknown") supporting.push({ id: "ev-loc", kind: "profile", text: `Last price ${f2(last.c)} is ${posTxt} ${priorTxt}.` });

  if (ev?.type === "upthrust" && rel === "above_value") {
    balance = "mixed";
    supporting.push({ id: "ev-adv", kind: "price_action", text: "Price has advanced over recent sessions and the value area has migrated higher." });
    contradicting.push({ id: "ev-ut", kind: "vsa", text: `Upthrust bar: spread ${ev.measurements.spreadVsAvg!.toFixed(2)}× average, volume ${ev.measurements.relativeVolume!.toFixed(2)}× average, close location ${ev.measurements.closeLocation!.toFixed(2)}.`, at: ev.barTime });
    scenarios = [
      { id: "sc-hold", title: "Higher-value acceptance continues", description: "The upthrust is a local rejection inside a broader advance; value continues to build above the prior range.", supportedBy: ["ev-profile", "ev-loc", "ev-adv"], challengedBy: ["ev-ut"], knowledgeSlugs: ["auction-acceptance-vs-excursion", "profile-shape-p"] },
      { id: "sc-fail", title: "Failed upside auction", description: "Higher prices could not be sustained; price rotates back toward the prior value area.", supportedBy: ["ev-ut"], challengedBy: ["ev-profile", "ev-adv"], knowledgeSlugs: ["auction-failed-auction", "vsa-upthrust"] },
      { id: "sc-cover", title: "Short-covering-driven advance exhausting", description: "The P-shape may reflect covering rather than new long participation; the rejection could mark the end of that impulse. This cannot be established from OHLCV alone.", supportedBy: ["ev-profile", "ev-ut"], challengedBy: [], knowledgeSlugs: ["profile-shape-p", "hypothesis-short-covering"] },
    ];
    watch = [
      { id: "w1", text: `Whether price re-enters and holds inside ${prior ? f2(prior.vah) : "prior value"} (the prior VAH)`, strengthens: ["sc-fail"], weakens: ["sc-hold"] },
      { id: "w2", text: `Whether price closes above the upthrust high (${f2(ev.referencePrices[0] ?? last.h)}) on steady volume`, strengthens: ["sc-hold"], weakens: ["sc-fail", "sc-cover"] },
      { id: "w3", text: "Whether volume expands on declines vs. rebounds over the next several bars", strengthens: ["sc-fail", "sc-cover"], weakens: ["sc-hold"] },
    ];
  } else if (ev && (ev.type === "shakeout" || ev.type === "stopping_volume")) {
    balance = "mixed";
    supporting.push({ id: "ev-vsa", kind: "vsa", text: `${ev.type.replace(/_/g, " ")} observed with volume ${ev.measurements.relativeVolume!.toFixed(2)}× average.`, at: ev.barTime });
    contradicting.push({ id: "ev-trend", kind: "price_action", text: `Prior trend was ${ev.measurements.priorTrend}; a single bar rarely resolves a prevailing direction.` });
    scenarios = [
      { id: "sc-fail", title: "Failed downside excursion", description: "Lower prices were not accepted and price returns toward prior value.", supportedBy: ["ev-vsa"], challengedBy: ["ev-trend"], knowledgeSlugs: ["auction-failed-auction", "vsa-shakeout"] },
      { id: "sc-cont", title: "Pause before continuation", description: "The reaction is temporary and the prior direction resumes.", supportedBy: ["ev-trend"], challengedBy: ["ev-vsa"], knowledgeSlugs: ["vsa-stopping-volume"] },
    ];
    watch = [
      { id: "w1", text: "Whether a retest of the low occurs on lower volume and holds", strengthens: ["sc-fail"], weakens: ["sc-cont"] },
      { id: "w2", text: "Whether price closes back below the event bar's low", strengthens: ["sc-cont"], weakens: ["sc-fail"] },
    ];
  } else if (ev?.type === "no_demand") {
    balance = "mixed";
    supporting.push({ id: "ev-vsa", kind: "vsa", text: `No-demand bar: volume ${ev.measurements.relativeVolume!.toFixed(2)}× average on ${ev.measurements.spreadVsAvg!.toFixed(2)}× average spread.`, at: ev.barTime });
    contradicting.push({ id: "ev-loc2", kind: "price_action", text: "Low-volume bars are common mid-session and may carry little information." });
    scenarios = [
      { id: "sc-stall", title: "Advance stalling", description: "Participation is thinning near the highs.", supportedBy: ["ev-vsa"], challengedBy: ["ev-loc2"], knowledgeSlugs: ["vsa-no-demand"] },
      { id: "sc-quiet", title: "Ordinary quiet period", description: "Reduced activity without directional meaning.", supportedBy: ["ev-loc2"], challengedBy: ["ev-vsa"], knowledgeSlugs: [] },
    ];
    watch = [{ id: "w1", text: "Whether the next expansion in volume occurs on rises or declines", strengthens: ["sc-stall"], weakens: ["sc-quiet"] }];
  } else {
    supporting.push({ id: "ev-state", kind: "structure", text: `Latest auction state: ${stateName}.` });
    balance = events.length === 0 ? "consistent" : "consistent";
    scenarios = [
      { id: "sc-bal", title: "Balance continues", description: "Rotation between value-area edges continues without a decisive auction.", supportedBy: ["ev-profile", "ev-state"], challengedBy: [], knowledgeSlugs: ["auction-balance"] },
      { id: "sc-brk", title: "Breakout attempt develops", description: "Price probes beyond the range; whether it is accepted is not yet known.", supportedBy: [], challengedBy: ["ev-state"], knowledgeSlugs: ["auction-acceptance-vs-excursion"] },
    ];
    watch = [
      { id: "w1", text: `Whether price trades and holds beyond ${f2(current.vah)} (VAH) or ${f2(current.val)} (VAL)`, strengthens: ["sc-brk"], weakens: ["sc-bal"] },
      { id: "w2", text: "Whether time and volume build outside the value area", strengthens: ["sc-brk"], weakens: ["sc-bal"] },
    ];
  }

  const uncertainty: Interpretation["uncertainty"] = [
    { kind: "estimated_profile", text: "Profiles are estimated from OHLCV bars. Volume-at-price is not exact traded volume." },
  ];
  if (sessionBarsN < 6) uncertainty.push({ kind: "small_sample", text: `Only ${sessionBarsN} of ${BARS_PER_SESSION} session bars have formed; the current profile may change materially.` });
  if (ev?.status === "provisional") uncertainty.push({ kind: "provisional", text: `The ${ev.type.replace(/_/g, " ")} observation is provisional; later bars may confirm or invalidate it.` });
  if (!prior) uncertainty.push({ kind: "missing_data", text: "No prior session is available, so value location cannot be assessed." });
  uncertainty.push({ kind: "other", text: "Participant identity and intent cannot be observed from price and volume; all causal explanations are hypotheses." });

  const evText = ev ? `${ev.type.replace(/_/g, " ")} (${ev.status})` : "no recent VSA events";
  return {
    asOf: last.t,
    whatIsHappening: nar(
      `${shape === "undetermined" ? "Profile still forming" : `${shape}-shaped profile`}, price ${posTxt} prior value, ${evText}.`,
      `The current session profile is ${shape === "undetermined" ? "not yet classifiable" : `${shape}-shaped`}. Price is ${posTxt} ${priorTxt}. The latest auction state is ${stateName}. Recent VSA activity: ${evText}.`,
      [`Session bars: ${sessionBarsN}/${BARS_PER_SESSION}. POC ${f2(current.poc)}, VAH ${f2(current.vah)}, VAL ${f2(current.val)}.`, ...current.shape.rationale, `Auction state '${stateName}' since ${state ? new Date(state.startTime * 1000).toISOString() : "n/a"}.`],
    ),
    whyItMatters: nar(
      "Location relative to value and recent rejection/acceptance evidence frame the possible outcomes.",
      "Where price trades relative to value, and whether it is accepted there with time and volume, are central to how auctions are read. A single rejection bar is local evidence; acceptance is established over multiple bars.",
      ["Price moving beyond a level briefly is an excursion; acceptance requires sustained time/volume there.", "Evidence is listed on both sides so competing readings stay visible."],
    ),
    context: nar(
      `Auction state: ${stateName}.`,
      `The broader structure is described as ${stateName}${state ? `: ${state.summary}` : "."}`,
      states.slice(-3).map((s) => `${s.kind.replace(/_/g, " ")} — ${s.summary}`),
    ),
    profile: nar(
      `${shape === "undetermined" ? "Undetermined" : shape}-shape; POC ${f2(current.poc)}.`,
      `The distribution suggests ${shape === "P" ? "activity concentrated in the upper part of the range" : shape === "b" ? "activity concentrated in the lower part of the range" : shape === "D" ? "a balanced, centered distribution" : shape === "B" ? "two distinct areas of acceptance" : "a profile that is not yet clearly classified"}. The shape alone does not establish who participated.`,
      [...current.shape.rationale, current.hvns.length ? `HVNs near ${current.hvns.map(f2).join(", ")}.` : "No high-volume nodes flagged.", current.lvns.length ? `LVNs near ${current.lvns.map(f2).join(", ")}.` : "No low-volume nodes flagged."],
    ),
    vsa: nar(
      ev ? `${ev.type.replace(/_/g, " ")} — ${ev.status}.` : "No recent VSA events.",
      ev ? `The latest observation is ${ev.type.replace(/_/g, " ")} (${ev.status}) with relative volume ${ev.measurements.relativeVolume!.toFixed(2)}× and close location ${ev.measurements.closeLocation!.toFixed(2)}. ${ev.implications[0] ?? ""}` : "No volume/spread pattern met detection conditions in the last several bars. Absence of a pattern is not itself a signal.",
      ev ? ev.conditions.map((c) => `${c.met ? "✓" : "✗"} ${c.label}: ${c.detail}`) : ["No conditions satisfied."],
    ),
    priceAction: nar(
      `Last close ${f2(last.c)}.`,
      `Last close ${f2(last.c)}; session range ${f2(current.sessionLow)}–${f2(current.sessionHigh)}.`,
      [`Open ${f2(last.o)}, high ${f2(last.h)}, low ${f2(last.l)}, close ${f2(last.c)}, volume ${last.v.toLocaleString()}.`],
    ),
    supporting, contradicting, scenarios, watchNext: watch, uncertainty,
    evidenceBalance: balance,
  };
}

// ---------------------------------------------------------------- top level

export function barQuality(bars: Bar[], estimated = true): DataQuality {
  const issues: DataQuality["issues"] = [];
  if (bars.length < 13) issues.push({ code: "insufficient_bars", severity: "warning", message: `Only ${bars.length} bars available; analysis requires at least one full session.` });
  issues.push({ code: "synthetic_data", severity: "info", message: "Synthetic fixture data. Not market data." });
  if (estimated) issues.push({ code: "estimated_profile", severity: "info", message: "Profiles are estimated from OHLCV; volume-at-price is not exact." });
  return {
    issues, barCount: bars.length,
    firstBarAt: bars[0]?.t ?? null, lastBarAt: bars[bars.length - 1]?.t ?? null,
    stale: false, hasVolume: bars.every((b) => b.v > 0), profileEstimated: estimated,
  };
}

export function analyse(symbol: string, bars: Bar[], k: number, script: InstrumentScript, timeframe: string, session: string): Analysis {
  const base = {
    symbol, timeframe, session, asOf: bars[k]?.t ?? 0,
    generatedAt: new Date(Date.UTC(2026, 9, 14, 0, 0, 0)).toISOString(),
    source: MOCK_SOURCE, analysisTimeframe: "30m",
  };
  const visible = bars.slice(0, k + 1);
  if (visible.length < BARS_PER_SESSION) {
    return { ...base, status: "insufficient_data", statusMessage: `At least ${BARS_PER_SESSION} bars (one session) are required; ${visible.length} available.`, quality: barQuality(visible), profiles: {}, valueLocation: null, vsaEvents: [], auctionStates: [], auctionTransitions: [], levels: [], interpretation: null };
  }
  const s = Math.floor(k / BARS_PER_SESSION);
  const cur = sessionBars(bars, s, k);
  const prevBars = s > 0 ? sessionBars(bars, s - 1, s * BARS_PER_SESSION - 1) : [];
  const comp = bars.slice(Math.max(0, s - 9) * BARS_PER_SESSION, k + 1);

  const mk = (kind: ProfileKind, slice: Bar[], label: string) => makeProfile(kind, slice, bars, k, label);
  const tpo = mk("tpo", cur, "TPO — current session");
  const vol = mk("volume", cur, "Volume — current session");
  const dev = mk("developing", cur, "Developing — session to date");
  if (dev) dev.developingTrack = developingTrack(bars, s, k);
  const prior = prevBars.length ? mk("prior", prevBars, "Prior session") : null;
  const composite = mk("composite", comp, `Composite — ${Math.min(10, s + 1)} sessions`);
  const profiles: Record<string, Profile> = {};
  for (const [key, p] of Object.entries({ tpo, volume: vol, developing: dev, prior, composite })) if (p) profiles[key] = p;

  const price = bars[k]!.c;
  const location: Analysis["valueLocation"] = prior
    ? { price, relativeTo: price > prior.vah ? "above_value" : price < prior.val ? "below_value" : "inside_value", referenceProfile: "Prior session value area", distanceFromPocPct: +(((price - prior.poc) / prior.poc) * 100).toFixed(2) }
    : { price, relativeTo: "unknown", referenceProfile: "n/a", distanceFromPocPct: null };

  const events = script.events.map((e) => buildEvent(e, bars, k, prior)).filter((e): e is VsaEvent => !!e);
  const { states, transitions } = buildAuction(script.states, bars, k);
  const levels = buildLevels(prior, prevBars, vol, composite);
  const interpretation = vol ? interpret({ bars, k, current: vol, prior, events, states, location }) : null;

  return { ...base, status: "ok", statusMessage: null, quality: barQuality(visible), profiles, valueLocation: location, vsaEvents: events, auctionStates: states, auctionTransitions: transitions, levels, interpretation };
}
