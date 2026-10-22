"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, KeyValue, Panel } from "@/components/ui/primitives";
import { useCreateJournal } from "@/hooks/data";
import { fmtPrice } from "@/lib/formatting";
import { computeSize, type DailyLimit } from "@/lib/sizing";

export interface Prefill { symbol: string; entry: number | null; stop: number | null; vah: number | null; val: number | null; poc: number | null; nonce: number }

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const money = (n: number) => `$${n.toFixed(2)}`;
// Feed prices arrive as raw floats (345.6099853515625); show at most 4 decimals.
const price = (n: number | null) => (n == null ? "" : String(Number(n.toFixed(4))));

function Field({ label, value, onChange, step = "any" }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input inputMode="decimal" type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-fg" />
    </label>
  );
}

export function Calculator({ equity, onEquity, limit, prefill, date }: {
  equity: number; onEquity: (n: number) => void; limit: DailyLimit; prefill: Prefill | null; date: string;
}) {
  const [symbol, setSymbol] = useState("");
  const [riskPct, setRiskPct] = useState("0.25");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [cost, setCost] = useState("0.05");
  const [fees, setFees] = useState("0");
  const create = useCreateJournal();

  useEffect(() => {
    if (!prefill) return;
    setSymbol(prefill.symbol);
    setEntry(price(prefill.entry));
    setStop(price(prefill.stop));
  }, [prefill]);

  const r = useMemo(() => computeSize({
    equity, riskFraction: num(riskPct) / 100, entry: num(entry), stop: num(stop), costPerShare: num(cost), fixedFees: num(fees),
    remainingAllowance: limit.remainingAllowance,
  }), [equity, riskPct, entry, stop, cost, fees, limit.remainingAllowance]);

  const canLog = !limit.blocked && !r.skipReason && symbol.trim() !== "";
  const log = () => {
    const sym = symbol.trim().toUpperCase();
    // Reference levels belong to the prefilled symbol only; a typed-in symbol has none.
    const ref = prefill && prefill.symbol.toUpperCase() === sym ? prefill : null;
    create.mutate({
      trade_date: date, symbol: sym, kind: "taken", setup_version: "A-1.0",
      prior_vah: ref?.vah ?? null, prior_val: ref?.val ?? null, prior_poc: ref?.poc ?? null,
      entry: num(entry), stop: num(stop), target: r.target, shares: r.shares, est_costs_per_share: num(cost), planned_loss: Number(r.modeledLoss.toFixed(2)),
    });
  };

  return (
    <Panel title="Position size calculator" description="Paper-trading maths from the plan. It sizes a modeled loss; real gaps and slippage can be worse.">
      {limit.blocked && <p role="alert" className="mb-3 rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm text-danger">Logging is blocked: {limit.reason}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted">Symbol
          <input aria-label="Trade symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-3 text-sm uppercase text-fg" />
        </label>
        <Field label="Paper equity ($)" value={String(equity)} onChange={(v) => onEquity(Number(v))} />
        <Field label="Risk per trade (%)" value={riskPct} onChange={setRiskPct} />
        <Field label="Entry price" value={entry} onChange={setEntry} />
        <Field label="Stop price" value={stop} onChange={setStop} />
        <Field label="Costs per share (round trip)" value={cost} onChange={setCost} />
        <Field label="Fixed fees ($)" value={fees} onChange={setFees} />
      </div>
      {r.skipReason ? (
        <p role="status" className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm text-warn">Skip: {r.skipReason}</p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Sizing result">
          <KeyValue k="Shares" v={<span data-testid="shares">{r.shares}</span>} />
          <KeyValue k="Risk budget" v={money(r.budget)} />
          <KeyValue k="Modeled loss" v={<span data-testid="loss">{money(r.modeledLoss)}</span>} />
          <KeyValue k="Target (2 x risk)" v={<span data-testid="target">{fmtPrice(r.target)}</span>} />
          <KeyValue k="Net profit at target" v={<span data-testid="profit">{money(r.netTargetProfit)}</span>} />
          <KeyValue k="Limited by" v={r.shares === r.notionalCapShares && r.notionalCapShares < r.riskSizedShares ? "20% size cap" : "Risk budget"} />
        </dl>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" disabled={!canLog || create.isPending} onClick={log}>{create.isPending ? "Logging…" : "Log trade"}</Button>
        {create.isSuccess && <span className="text-xs text-ok" role="status">Logged.</span>}
        {create.isError && <span className="text-xs text-danger" role="alert">{create.error instanceof Error ? create.error.message : "Could not log the trade."}</span>}
      </div>
    </Panel>
  );
}
