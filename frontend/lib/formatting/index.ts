import type { DetectionStatus } from "@/types";

export const EXCHANGE_TZ = "America/New_York";

export const fmtPrice = (n: number | null | undefined, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? "—" : n.toFixed(d));

export const fmtVolume = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));

export const fmtPct = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`);

export const fmtMultiple = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(2)}×`);

/** Unix seconds → "Oct 13, 14:30" in exchange time. */
export function fmtDateTime(t: number, withZone = false): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: EXCHANGE_TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t * 1000)) +
    (withZone ? " ET" : "")
  );
}

export function fmtDate(t: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: EXCHANGE_TZ, year: "numeric", month: "short", day: "numeric" }).format(new Date(t * 1000));
}

export function fmtTime(t: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: EXCHANGE_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t * 1000));
}

/** ISO date (YYYY-MM-DD) in exchange time. */
export function isoDate(t: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: EXCHANGE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t * 1000));
  return parts;
}

/** Unix seconds for the end of a calendar date. US regular-session bars never cross 00:00 UTC, so UTC day-end is safe. */
export function endOfDate(date: string): number {
  return Date.parse(`${date}T23:59:59Z`) / 1000;
}

export const PATTERN_LABELS: Record<string, string> = {
  upthrust: "Upthrust",
  shakeout: "Shakeout",
  stopping_volume: "Stopping volume",
  buying_climax: "Buying climax",
  selling_climax: "Selling climax",
  no_demand: "No demand",
  no_supply: "No supply",
  test_of_supply: "Test of supply",
  high_volume_churn: "High-volume churn",
  effort_vs_result: "Effort vs result",
  volume_divergence: "Volume divergence",
};

/** Short marker text for the chart. */
export const PATTERN_CODES: Record<string, string> = {
  upthrust: "UT", shakeout: "SO", stopping_volume: "SV", buying_climax: "BC", selling_climax: "SC", no_demand: "ND",
  no_supply: "NS", test_of_supply: "TS", high_volume_churn: "HV", effort_vs_result: "ER", volume_divergence: "VD",
};

export const STATUS_LABELS: Record<DetectionStatus, string> = {
  observed: "Observed", provisional: "Provisional", confirmed: "Confirmed", invalidated: "Invalidated", expired: "Expired (no follow-through)", historical: "Historical observation",
};

export const AUCTION_LABELS: Record<string, string> = {
  balance: "Balance",
  breakout_attempt: "Breakout attempt",
  acceptance: "Acceptance",
  rejection: "Rejection",
  failed_auction: "Failed auction",
  value_migration: "Value migration",
  trend_development: "Trend development",
  distribution_transition: "Distribution transition",
  indeterminate: "Indeterminate (no complete prior session)",
  upward_breakout_attempt: "Upward breakout attempt",
  downward_breakout_attempt: "Downward breakout attempt",
  higher_price_acceptance: "Higher-price acceptance",
  lower_price_acceptance: "Lower-price acceptance",
  rejection_above_value: "Rejection above value",
  rejection_below_value: "Rejection below value",
};

export const patternLabel = (t: string) => PATTERN_LABELS[t] ?? humanize(t);
export const patternCode = (t: string) => PATTERN_CODES[t] ?? t.split("_").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 3);
export const auctionLabel = (k: string) => AUCTION_LABELS[k] ?? humanize(k);


export const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
