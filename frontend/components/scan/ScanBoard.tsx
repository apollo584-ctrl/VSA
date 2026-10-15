"use client";

import { ArrowDownRight, ArrowUpRight, Radar } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StateMessage } from "@/components/common/states";
import { Badge, Button, Panel, Segmented } from "@/components/ui/primitives";
import { useLoadSymbol, useRunScan, useScan, useScanAuto } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";
import { fmtDateTime, fmtPrice } from "@/lib/formatting";
import type { RawScanResult } from "@/lib/api/backend/schemas";

const FACTOR: Record<string, string> = { value_location: "Value location", auction_state: "Auction", vsa: "VSA", price_action: "Price action" };
type Filter = "all" | "strength" | "weakness";

export function ScanBoard() {
  const scan = useScan();
  const run = useRunScan();
  const auto = useScanAuto();
  const load = useLoadSymbol();
  const { selectInstrument } = useWorkspace();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [opening, setOpening] = useState<string | null>(null);

  if (scan.isError) {
    return <StateMessage icon={Radar} title="Scanner unavailable">{scan.error instanceof Error ? scan.error.message : "The scanner could not be reached."}</StateMessage>;
  }
  const status = scan.data?.status;
  const results = scan.data?.results ?? [];
  const hits = results.filter((r) => r.direction !== "none");
  const shown = hits.filter((r) => filter === "all" || r.direction === filter);
  const errors = results.filter((r) => r.status === "error").length;

  const open = (symbol: string) => {
    setOpening(symbol);
    load.mutate(symbol, { onSuccess: ({ datasetId }) => { selectInstrument(datasetId); router.push("/"); }, onSettled: () => setOpening(null) });
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="S&P 500 scan"
        description="Flags a symbol when at least three of four independent readings agree and none disagree: value location, auction state, active VSA signals and price action."
        actions={
          <>
            <Segmented<string> label="Auto-scan" size="sm" value={String(status?.auto_minutes ?? 0)} onChange={(v) => auto.mutate(Number(v))}
              options={[{ value: "0", label: "Auto off" }, { value: "15", label: "15 min" }, { value: "30", label: "30 min" }, { value: "60", label: "60 min" }]} />
            <Button variant="primary" size="sm" disabled={status?.running || run.isPending} onClick={() => run.mutate()}>{status?.running ? "Scanning…" : "Scan now"}</Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted" aria-live="polite">
          {status?.running
            ? <span>Scanning {status.done} of {status.total} symbols…</span>
            : status?.finished_at ? <span>Last scan finished {fmtDateTime(Date.parse(status.finished_at) / 1000, true)}</span>
            : results.length ? <span>Showing the last saved scan.</span> : <span>No scan has run yet. Press Scan now.</span>}
          <span>{hits.length} flagged of {results.length - errors} analysed{errors ? ` · ${errors} could not be loaded` : ""}</span>
        </div>
        {status?.running && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${status.total ? (100 * status.done) / status.total : 0}%` }} /></div>}
        {(run.isError || auto.isError) && <p role="alert" className="mt-3 text-sm text-danger">{((run.error ?? auto.error) as Error).message}</p>}
        <p className="mt-3 text-xs text-subtle">Data comes from Yahoo Finance's unofficial endpoint, delayed and rate-limited, so a full scan takes a few minutes. Auto-scan only runs while this app is open. Flags describe aligned evidence, not predictions or advice.</p>
      </Panel>

      <Panel title="Flagged symbols" actions={<Segmented<Filter> label="Direction" size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "strength", label: "Strength" }, { value: "weakness", label: "Weakness" }]} />}>
        {shown.length === 0
          ? <p className="text-sm text-muted">{results.length ? "Nothing currently meets the confluence rule." : "Results appear here after a scan."}</p>
          : <ul className="divide-y divide-border">{shown.map((r) => <Row key={r.symbol} r={r} opening={opening === r.symbol} onOpen={() => open(r.symbol)} />)}</ul>}
        {load.isError && <p role="alert" className="mt-3 text-sm text-danger">{load.error instanceof Error ? load.error.message : "Could not open this symbol."}</p>}
      </Panel>
    </div>
  );
}

function Row({ r, opening, onOpen }: { r: RawScanResult; opening: boolean; onOpen: () => void }) {
  const strong = r.direction === "strength";
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-base font-semibold">{r.symbol}</span>
          <Badge tone={strong ? "ok" : "danger"}>{strong ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}{strong ? "Strength" : "Weakness"} · {r.agreeing} of 4</Badge>
          <span className="text-sm text-muted">{r.name} · {r.sector}</span>
        </div>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
          {r.votes.filter((v) => v.vote !== 0).map((v) => <li key={v.factor}><span className="text-muted">{FACTOR[v.factor]}:</span> {v.text}</li>)}
        </ul>
        <p className="mt-1 text-xs text-subtle">{r.last_close != null && <>Last close {fmtPrice(r.last_close)} · </>}{r.last_bar_at && <>bar closed {fmtDateTime(Date.parse(r.last_bar_at) / 1000, true)}</>}</p>
      </div>
      <Button size="sm" disabled={opening} onClick={onOpen}>{opening ? "Opening…" : "Open analysis"}</Button>
    </li>
  );
}
