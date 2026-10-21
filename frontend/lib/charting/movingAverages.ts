import { EXCHANGE_TZ } from "@/lib/formatting";
import type { Bar } from "@/types";

export const MA_PERIODS = { ma50: 50, ma200: 200 } as const;

export interface MaPoint { time: number; value: number }

/** Simple moving average of the close. The first period-1 bars have no value and are omitted (never zero). */
export function sma(bars: Bar[], period: number): MaPoint[] {
  const out: MaPoint[] = [];
  if (period < 1 || bars.length < period) return out;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i]!.c;
    if (i >= period) sum -= bars[i - period]!.c;
    if (i >= period - 1) out.push({ time: bars[i]!.t, value: sum / period });
  }
  return out;
}

/**
 * Moving average over every loaded bar (so the line has history), then cut at the last visible bar so
 * a replay never shows values from after its cursor.
 */
export function smaUpTo(allBars: Bar[], visible: Bar[], period: number): MaPoint[] {
  const last = visible[visible.length - 1]?.t;
  if (last === undefined) return [];
  return sma(allBars, period).filter((p) => p.time <= last);
}

export interface DailyBar { session: string; close: number }

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: EXCHANGE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** Exchange-local calendar date (YYYY-MM-DD) of a unix-seconds time. */
export const exchangeDate = (t: number): string => dayFmt.format(new Date(t * 1000));

/**
 * Daily SMA drawn on intraday bars: the last (period-1) COMPLETED days before the bar's session plus the
 * bar's own close. Bars without enough completed days are omitted.
 */
export function dailySmaForBars(dailyBars: DailyBar[], chartBars: Bar[], period: number): MaPoint[] {
  if (period < 1 || dailyBars.length < period) return [];
  const days = [...dailyBars].sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : 0));
  const prefix = [0];
  for (const d of days) prefix.push(prefix[prefix.length - 1]! + d.close);
  const out: MaPoint[] = [];
  let k = -1; // index of the last day strictly before the current bar's session
  for (const b of chartBars) {
    const d = exchangeDate(b.t);
    while (k + 1 < days.length && days[k + 1]!.session < d) k++;
    // Today's partial day counts at the bar's own close: the average moves with price (a curve, not steps)
    // and uses only completed days plus the bar itself, so there is no lookahead.
    if (k + 1 >= period - 1 && k >= 0) out.push({ time: b.t, value: (prefix[k + 1]! - prefix[k + 1 - (period - 1)]! + b.c) / period });
  }
  return out;
}
