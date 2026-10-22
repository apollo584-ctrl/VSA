import { describe, expect, it } from "vitest";
import { computeSize, dailyLimit } from "@/lib/sizing";

const base = { equity: 10000, riskFraction: 0.0025, entry: 50, stop: 49.5, costPerShare: 0.05 };

describe("computeSize", () => {
  it("matches the plan's worked example", () => {
    const r = computeSize(base);
    expect(r.riskSizedShares).toBe(45);
    expect(r.notionalCapShares).toBe(40);
    expect(r.shares).toBe(40);
    expect(r.modeledLoss).toBeCloseTo(22, 6);
    expect(r.target).toBeCloseTo(51, 6);
    expect(r.netTargetProfit).toBeCloseTo(38, 6);
    expect(r.skipReason).toBeNull();
  });

  it("caps the risk budget by the remaining daily allowance", () => {
    const r = computeSize({ ...base, remainingAllowance: 10 });
    expect(r.budget).toBe(10);
    expect(r.shares).toBe(18);
  });

  it("skips when the budget does not cover fees, the stop is not below entry, or size is zero", () => {
    expect(computeSize({ ...base, fixedFees: 25 }).skipReason).toMatch(/fees/i);
    expect(computeSize({ ...base, stop: 50 }).skipReason).toMatch(/stop/i);
    expect(computeSize({ ...base, stop: 51 }).shares).toBe(0);
    expect(computeSize({ ...base, remainingAllowance: 0 }).skipReason).toMatch(/allowance/i);
    expect(computeSize({ ...base, equity: 1000, entry: 500, stop: 499 }).skipReason).toMatch(/zero/i);
    expect(computeSize({ ...base, entry: NaN }).skipReason).toBeTruthy();
  });
});

describe("dailyLimit", () => {
  it("blocks after 3 losses or a 1% realized loss", () => {
    expect(dailyLimit({ date: "d", trades: 3, losses: 3, realized_pnl: -10 }, 10000).blocked).toBe(true);
    expect(dailyLimit({ date: "d", trades: 1, losses: 1, realized_pnl: -100 }, 10000).blocked).toBe(true);
    const ok = dailyLimit({ date: "d", trades: 1, losses: 1, realized_pnl: -40 }, 10000);
    expect(ok.blocked).toBe(false);
    expect(ok.remainingAllowance).toBeCloseTo(60, 6);
    expect(dailyLimit(null, 10000).remainingAllowance).toBe(100);
  });
});
