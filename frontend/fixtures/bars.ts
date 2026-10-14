/**
 * MOCK DATA — deterministic synthetic bars. Not real market data.
 * Used only when NEXT_PUBLIC_API_MODE=mock. Instrument symbols are deliberately non-real (FIXA/FIXB/FIXC).
 */
import type { Bar } from "@/types";

export const BARS_PER_SESSION = 13; // 30-minute RTH bars, 09:30–16:00 America/New_York
const BAR_SECONDS = 1800;

/** mulberry32 — small seeded PRNG so fixtures are identical on every run. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SESSION_DATES = [
  "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05",
  "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13",
];

/** 09:30 ET during EDT == 13:30 UTC. */
export function sessionOpen(date: string): number {
  return Date.parse(`${date}T13:30:00Z`) / 1000;
}

type Curve = (t: number) => number; // t in [0,1] → price

export const curves = {
  balance: (center: number, amp: number, phase = 0): Curve => (t) => center + amp * Math.sin(t * Math.PI * 2 + phase),
  drift: (from: number, to: number): Curve => (t) => from + (to - from) * t,
  /** Quick advance, then hold near the top → P-like distribution. */
  rampThenHold: (from: number, to: number, rampEnd = 0.3): Curve => (t) =>
    t < rampEnd ? from + ((to - from) * t) / rampEnd : to + (to - from) * 0.04 * Math.sin((t - rampEnd) * 9),
  /** Quick decline, then hold near the low → b-like distribution. */
  dropThenHold: (from: number, to: number, dropEnd = 0.3): Curve => (t) =>
    t < dropEnd ? from + ((to - from) * t) / dropEnd : to + Math.abs(to - from) * 0.04 * Math.sin((t - dropEnd) * 9),
};

export interface SessionPlan {
  date: string;
  curve: Curve;
  volume: number; // base volume per bar
  noise: number; // price noise std-ish
}

export interface BarOverride {
  /** global bar index */
  index: number;
  patch: (bar: Bar, prev: Bar | undefined) => Bar;
}

export function generateBars(plans: SessionPlan[], seed: number, overrides: BarOverride[] = []): Bar[] {
  const rand = rng(seed);
  const bars: Bar[] = [];
  let prevClose = plans[0]?.curve(0) ?? 100;
  for (const plan of plans) {
    const open0 = sessionOpen(plan.date);
    for (let i = 0; i < BARS_PER_SESSION; i++) {
      const t = (i + 1) / BARS_PER_SESSION;
      const target = plan.curve(t) + (rand() - 0.5) * plan.noise * 2;
      const o = i === 0 ? prevClose + (rand() - 0.5) * plan.noise : prevClose;
      const c = target;
      const wickUp = rand() * plan.noise * 1.2;
      const wickDn = rand() * plan.noise * 1.2;
      const h = Math.max(o, c) + wickUp;
      const l = Math.min(o, c) - wickDn;
      // intraday U-shaped volume: heavier at open and close
      const u = 1 + 0.9 * Math.pow(Math.abs(t - 0.5) * 2, 2) + (i === 0 ? 0.5 : 0);
      const v = Math.round(plan.volume * u * (0.75 + rand() * 0.5));
      bars.push({ t: open0 + i * BAR_SECONDS, o: r2(o), h: r2(h), l: r2(l), c: r2(c), v });
      prevClose = c;
    }
  }
  for (const ov of overrides) {
    const prev = bars[ov.index - 1];
    const cur = bars[ov.index];
    if (!cur) continue;
    const next = ov.patch(cur, prev);
    bars[ov.index] = { ...next, o: r2(next.o), h: r2(next.h), l: r2(next.l), c: r2(next.c) };
    // keep continuity with the following bar's open
    const after = bars[ov.index + 1];
    if (after) after.o = r2(next.c);
  }
  return bars;
}

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Aggregate 30m bars into daily bars (one per session). */
export function toDaily(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i += BARS_PER_SESSION) {
    const chunk = bars.slice(i, i + BARS_PER_SESSION);
    if (!chunk.length) continue;
    out.push({
      t: chunk[0]!.t,
      o: chunk[0]!.o,
      h: Math.max(...chunk.map((b) => b.h)),
      l: Math.min(...chunk.map((b) => b.l)),
      c: chunk[chunk.length - 1]!.c,
      v: chunk.reduce((a, b) => a + b.v, 0),
    });
  }
  return out;
}

// ---------- Instruments ----------

/** FIXA: balance → downside shakeout → advance → P-shaped session ending with an upthrust. */
export function buildFixA(): Bar[] {
  const D = SESSION_DATES;
  const plans: SessionPlan[] = [
    { date: D[0]!, curve: curves.balance(100, 1.3, 0.2), volume: 118000, noise: 0.35 },
    { date: D[1]!, curve: curves.balance(100.4, 1.6, 1.1), volume: 112000, noise: 0.35 },
    { date: D[2]!, curve: curves.balance(99.8, 1.4, 2.0), volume: 109000, noise: 0.34 },
    { date: D[3]!, curve: curves.balance(100.2, 1.5, 0.5), volume: 114000, noise: 0.35 },
    { date: D[4]!, curve: curves.balance(100.1, 1.2, 3.0), volume: 108000, noise: 0.33 },
    { date: D[5]!, curve: curves.balance(99.9, 1.7, 1.7), volume: 111000, noise: 0.36 },
    { date: D[6]!, curve: curves.dropThenHold(99.9, 97.6, 0.4), volume: 126000, noise: 0.38 },
    { date: D[7]!, curve: curves.drift(98.8, 101.2), volume: 121000, noise: 0.36 },
    { date: D[8]!, curve: curves.drift(101.2, 103.6), volume: 117000, noise: 0.34 },
    { date: D[9]!, curve: curves.drift(103.6, 105.4), volume: 113000, noise: 0.33 },
    { date: D[10]!, curve: curves.balance(105.6, 0.7, 0.4), volume: 98000, noise: 0.3 },
    { date: D[11]!, curve: curves.rampThenHold(105.8, 108.2, 0.35), volume: 119000, noise: 0.34 },
    { date: D[12]!, curve: curves.rampThenHold(108.3, 110.6, 0.3), volume: 124000, noise: 0.34 },
  ];
  const at = (s: number, i: number) => s * BARS_PER_SESSION + i;
  const overrides: BarOverride[] = [
    // Session 6: wide-spread down bar, very high volume, close well off the low (selling climax / stopping volume)
    { index: at(6, 4), patch: (b) => ({ ...b, l: b.c - 0.55, c: b.c - 0.1, v: Math.round(b.v * 2.4) }) },
    // Session 6 bar 5: shakeout – dips under prior balance low and closes back inside
    { index: at(6, 6), patch: (b) => ({ ...b, l: Math.min(b.l, 96.9), c: b.o + 0.55, v: Math.round(b.v * 1.9) }) },
    // Session 10: narrow-spread up bar on low volume (no demand)
    { index: at(10, 7), patch: (b, p) => ({ ...b, o: p?.c ?? b.o, c: (p?.c ?? b.o) + 0.12, h: (p?.c ?? b.o) + 0.2, l: (p?.c ?? b.o) - 0.03, v: Math.round(b.v * 0.38) }) },
    // Session 12: upthrust – spikes above morning high, closes near the low on high volume
    {
      index: at(12, 8),
      patch: (b, p) => {
        const base = p?.c ?? b.o;
        return { ...b, o: base, h: base + 1.15, l: base - 0.18, c: base - 0.05, v: Math.round(b.v * 2.7) };
      },
    },
  ];
  return generateBars(plans, 7, overrides);
}

/** FIXB: orderly balance — no VSA events expected. */
export function buildFixB(): Bar[] {
  const plans: SessionPlan[] = SESSION_DATES.map((date, i) => ({
    date,
    curve: curves.balance(50 + (i % 3) * 0.1, 0.55, i * 0.9),
    volume: 80000,
    noise: 0.14,
  }));
  return generateBars(plans, 21);
}

/** FIXC: too few bars for analysis. */
export function buildFixC(): Bar[] {
  const plans: SessionPlan[] = [{ date: SESSION_DATES[12]!, curve: curves.drift(20, 20.4), volume: 30000, noise: 0.08 }];
  return generateBars(plans, 33).slice(0, 5);
}
