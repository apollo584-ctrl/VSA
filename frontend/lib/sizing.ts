/** Position sizing from "VSA Trading Plan.md" section 3. A paper-trading study model: it never places orders. */

export const DAILY_LOSS_FRACTION = 0.01;
export const MAX_DAILY_LOSSES = 3;
export const NOTIONAL_CAP_FRACTION = 0.2;

export interface SizingInput {
  equity: number;
  /** Risk fraction per trade, e.g. 0.0025 for 0.25%. */
  riskFraction: number;
  entry: number;
  stop: number;
  /** Estimated round-trip costs and slippage per share. */
  costPerShare: number;
  /** Fixed round-trip fees. */
  fixedFees?: number;
  /** Remaining daily loss allowance; omit for no daily cap. */
  remainingAllowance?: number;
}

export interface SizingResult {
  budget: number;
  riskSizedShares: number;
  notionalCapShares: number;
  shares: number;
  modeledLoss: number;
  target: number;
  netTargetProfit: number;
  skipReason: string | null;
}

const bad = (n: number) => !Number.isFinite(n);

export function computeSize(i: SizingInput): SizingResult {
  const F = i.fixedFees ?? 0;
  const d = i.entry - i.stop;
  const budget = Math.min(i.equity * i.riskFraction, i.remainingAllowance ?? Infinity);
  const target = i.entry + 2 * d;
  const empty = { budget: Number.isFinite(budget) ? budget : 0, riskSizedShares: 0, notionalCapShares: 0, shares: 0, modeledLoss: 0, target: Number.isFinite(target) ? target : 0, netTargetProfit: 0 };
  if ([i.equity, i.riskFraction, i.entry, i.stop, i.costPerShare, F].some(bad) || i.equity <= 0 || i.entry <= 0 || i.costPerShare < 0 || F < 0 || i.riskFraction <= 0) {
    return { ...empty, skipReason: "Fill in equity, risk, entry, stop and costs with valid numbers." };
  }
  if (d <= 0) return { ...empty, skipReason: "The stop must be below the entry price." };
  if (budget <= F) return { ...empty, skipReason: budget <= 0 ? "No daily loss allowance is left, so no new trade." : "The risk budget does not cover the fixed fees." };
  const riskSizedShares = Math.floor((budget - F) / (d + i.costPerShare));
  const notionalCapShares = Math.floor((NOTIONAL_CAP_FRACTION * i.equity) / i.entry);
  const shares = Math.max(0, Math.min(riskSizedShares, notionalCapShares));
  const base = {
    budget, riskSizedShares, notionalCapShares, shares, target,
    modeledLoss: shares * (d + i.costPerShare) + (shares > 0 ? F : 0),
    netTargetProfit: shares * (2 * d - i.costPerShare) - (shares > 0 ? F : 0),
  };
  if (shares <= 0) return { ...base, skipReason: "The position would be zero shares after the risk and 20% size limits." };
  return { ...base, skipReason: null };
}

export interface DaySummaryLike { date?: string; trades: number; losses: number; realized_pnl: number }

export interface DailyLimit { blocked: boolean; reason: string | null; remainingAllowance: number }

/** Plan section 3: stop new entries after 3 losses or realized net P/L <= -1% of session-start equity. */
export function dailyLimit(summary: DaySummaryLike | null | undefined, equity: number): DailyLimit {
  const pnl = summary?.realized_pnl ?? 0;
  const losses = summary?.losses ?? 0;
  const allowance = Math.max(0, DAILY_LOSS_FRACTION * equity + pnl);
  if (losses >= MAX_DAILY_LOSSES) return { blocked: true, reason: `${losses} losing trades today. The plan says stop for the day.`, remainingAllowance: allowance };
  if (equity > 0 && pnl <= -DAILY_LOSS_FRACTION * equity) return { blocked: true, reason: "Today's realized loss has reached 1% of your starting equity. The plan says stop for the day.", remainingAllowance: 0 };
  return { blocked: false, reason: null, remainingAllowance: allowance };
}
