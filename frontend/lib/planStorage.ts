import { EXCHANGE_TZ } from "@/lib/formatting";

/** Small localStorage helpers; storage can be blocked or full, so every call is wrapped. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}

export function writeJson(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export const KEYS = {
  watchlist: "plan.watchlist",
  equity: "plan.equity",
  checklist: (date: string) => `plan.checklist.${date}`,
};

export const MAX_WATCHLIST = 8;

/** Wall-clock parts in New York for a given instant. */
function nyParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: EXCHANGE_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

export function nyDate(d = new Date()): string {
  const p = nyParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** True on weekdays between 9:30 and 16:00 New York time (holidays are not modelled; the backend decides eligibility). */
export function isMarketHours(d = new Date()): boolean {
  const p = nyParts(d);
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const mins = Number(p.hour) * 60 + Number(p.minute);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export const CHECKLIST_ITEMS = [
  "Confirm this is a full regular trading session and write down your starting paper equity.",
  "Write down today's scheduled economic releases and each watchlist stock's earnings status.",
  "Freeze the watchlist and note the daily, index and sector context as observations only.",
  "Confirm the data source, adjustment basis, timeframe, engine settings and last completed-bar time.",
  "Check the prior session is the day right before and complete; write down its VAH, VAL and POC.",
  "Work out the day's risk per trade and loss allowance, and check your paper order controls.",
];
