"use client";

import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useCreateJournal, useDaySummary } from "@/hooks/data";
import { KEYS, MAX_WATCHLIST, nyDate, readJson, writeJson } from "@/lib/planStorage";
import type { SetupASymbol } from "@/lib/planTypes";
import { dailyLimit } from "@/lib/sizing";
import { Calculator, type Prefill } from "./Calculator";
import { Checklist } from "./Checklist";
import { Journal } from "./Journal";
import { Watchlist } from "./Watchlist";

export function PlanBoard() {
  const [date, setDate] = useState(() => nyDate());
  const [symbols, setSymbols] = useState<string[]>([]);
  const [equity, setEquity] = useState(10000);
  const [ready, setReady] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const summary = useDaySummary(date);
  const create = useCreateJournal();

  useEffect(() => {
    const w = readJson<unknown>(KEYS.watchlist, []);
    if (Array.isArray(w)) setSymbols(w.filter((s): s is string => typeof s === "string").slice(0, MAX_WATCHLIST));
    const e = readJson<unknown>(KEYS.equity, 10000);
    if (typeof e === "number" && e > 0) setEquity(e);
    setReady(true);
  }, []);

  // Roll the New York date forward when the page stays open past midnight or wakes from sleep.
  useEffect(() => {
    const tick = () => setDate(nyDate());
    const id = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);

  const changeSymbols = (s: string[]) => { setSymbols(s); if (ready) writeJson(KEYS.watchlist, s); };
  const changeEquity = (n: number) => { setEquity(n); if (ready && n > 0) writeJson(KEYS.equity, n); };
  // Until today's results are loaded the daily limit is unknown, so logging stays blocked.
  const limit = summary.data ? dailyLimit(summary.data, equity) : {
    blocked: true, remainingAllowance: 0,
    reason: summary.isError ? "Today's results could not be loaded from the journal, so the daily limit cannot be checked." : "Loading today's results to check the daily limit…",
  };

  const use = (s: SetupASymbol) =>
    setPrefill({ symbol: s.symbol, entry: s.entry_reference ?? null, stop: s.stop ?? null, vah: s.prior_vah ?? null, val: s.prior_val ?? null, poc: s.prior_poc ?? null, nonce: Date.now() });
  const skip = (s: SetupASymbol) =>
    create.mutate({
      trade_date: date, symbol: s.symbol, kind: "skipped", setup_version: "A-1.0", prior_vah: s.prior_vah ?? null, prior_val: s.prior_val ?? null, prior_poc: s.prior_poc ?? null,
      skip_reason: (s.no_trade_reasons.length ? s.no_trade_reasons.join("; ") : s.explanation) || `Stage: ${s.stage}`,
    });

  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="rounded-lg border border-border bg-surface-2 p-3 text-xs leading-relaxed text-muted">
        This is a study and paper-trading tool. It is not advice and it never places orders.
      </p>
      {limit.blocked && summary.data && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <ShieldAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span><strong>Daily limit reached.</strong> {limit.reason}</span>
        </div>
      )}
      {create.isError && <p role="alert" className="text-xs text-danger">{create.error instanceof Error ? create.error.message : "Could not log."}</p>}
      {create.isSuccess && <p role="status" className="text-xs text-ok">Saved to the journal.</p>}
      <Checklist date={date} />
      <Watchlist symbols={symbols} onChange={changeSymbols} onUse={use} onSkip={skip} />
      <Calculator equity={equity} onEquity={changeEquity} limit={limit} prefill={prefill} date={date} />
      <Journal date={date} />
    </div>
  );
}
