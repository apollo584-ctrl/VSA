"use client";

import { Radar, X } from "lucide-react";
import { useEffect, useState } from "react";
import { StateMessage } from "@/components/common/states";
import { Badge, Button, Panel } from "@/components/ui/primitives";
import { useSetupA } from "@/hooks/data";
import { ApiError } from "@/lib/api/errors";
import { fmtPrice } from "@/lib/formatting";
import { MAX_WATCHLIST, isMarketHours } from "@/lib/planStorage";
import type { SetupASymbol } from "@/lib/planTypes";

const STAGE: Record<string, { label: string; tone: "neutral" | "info" | "warn" | "danger" | "ok" }> = {
  no_data: { label: "No data", tone: "warn" },
  not_eligible: { label: "Not eligible today", tone: "neutral" },
  waiting: { label: "Waiting", tone: "neutral" },
  counting: { label: "Counting closes", tone: "info" },
  retest_watch: { label: "Watching for retest", tone: "info" },
  triggered: { label: "Triggered", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

export function Watchlist({ symbols, onChange, onUse, onSkip }: {
  symbols: string[]; onChange: (s: string[]) => void; onUse: (s: SetupASymbol) => void; onSkip: (s: SetupASymbol) => void;
}) {
  const [draft, setDraft] = useState("");
  const q = useSetupA(symbols);
  const { refetch } = q;

  // Refresh every 60 seconds while the regular session is open (9:30-16:00 New York).
  useEffect(() => {
    if (symbols.length === 0) return;
    const id = setInterval(() => { if (isMarketHours()) void refetch(); }, 60_000);
    return () => clearInterval(id);
  }, [symbols.length, refetch]);

  const add = () => {
    const s = draft.trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,12}$/.test(s) || symbols.includes(s) || symbols.length >= MAX_WATCHLIST) return;
    onChange([...symbols, s]);
    setDraft("");
  };

  const unsupported = q.error instanceof ApiError && q.error.code === "not_supported";

  return (
    <Panel title="Watchlist: Setup A status" description="Price closes above the prior day's value area three times, then comes back to test it. A study checklist, not advice."
      actions={<Button size="sm" variant="primary" disabled={symbols.length === 0 || q.isFetching} onClick={() => void refetch()}>{q.isFetching ? "Checking…" : "Check now"}</Button>}>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input aria-label="Add a symbol" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. AAPL" disabled={symbols.length >= MAX_WATCHLIST}
          className="h-9 w-32 rounded-lg border border-border bg-surface px-3 text-sm uppercase" />
        <Button size="sm" type="submit" disabled={!draft.trim() || symbols.length >= MAX_WATCHLIST}>Add</Button>
        <span className="text-xs text-muted">{symbols.length} of {MAX_WATCHLIST} symbols</span>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {symbols.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium">
            {s}
            <button type="button" aria-label={`Remove ${s}`} className="text-muted hover:text-fg" onClick={() => onChange(symbols.filter((x) => x !== s))}><X size={12} aria-hidden /></button>
          </span>
        ))}
      </div>
      {symbols.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Add up to {MAX_WATCHLIST} symbols to see where each one stands.</p>
      ) : unsupported ? (
        <StateMessage icon={Radar} tone="warn" title="This needs the real backend">The setup checker uses live market data, which demo mode does not have.</StateMessage>
      ) : q.isError ? (
        <StateMessage icon={Radar} tone="danger" title="Setup status unavailable">{q.error instanceof Error ? q.error.message : "Something went wrong."}</StateMessage>
      ) : q.isPending ? (
        <p className="mt-4 text-sm text-muted">Checking…</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {q.data.symbols.map((s) => <Card key={s.symbol} s={s} onUse={() => onUse(s)} onSkip={() => onSkip(s)} />)}
        </div>
      )}
    </Panel>
  );
}

function Card({ s, onUse, onSkip }: { s: SetupASymbol; onUse: () => void; onSkip: () => void }) {
  const st = STAGE[s.stage] ?? { label: s.stage, tone: "neutral" as const };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm" data-testid={`card-${s.symbol}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{s.symbol}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="text-xs text-muted">Closes above value: {s.acceptance_closes}/3{s.stage === "retest_watch" && s.retest_bars_left != null ? ` · ${s.retest_bars_left} bars left to retest` : ""}</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div><div className="text-muted">VAH</div>{fmtPrice(s.prior_vah)}</div>
        <div><div className="text-muted">VAL</div>{fmtPrice(s.prior_val)}</div>
        <div><div className="text-muted">POC</div>{fmtPrice(s.prior_poc)}</div>
      </div>
      {s.explanation && <p className="text-xs leading-relaxed">{s.explanation}</p>}
      {s.no_trade_reasons.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-warn">{s.no_trade_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {s.stage === "triggered" && <Button size="sm" variant="primary" onClick={onUse}>Use in calculator</Button>}
        <Button size="sm" onClick={onSkip}>Log skip</Button>
      </div>
    </div>
  );
}
