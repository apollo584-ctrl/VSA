"use client";

import { BookOpen } from "lucide-react";
import { useState } from "react";
import { StateMessage } from "@/components/common/states";
import { Badge, Button, Panel, Segmented } from "@/components/ui/primitives";
import { useJournal, useUpdateJournal } from "@/hooks/data";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { fmtPrice } from "@/lib/formatting";
import type { JournalEntry } from "@/lib/planTypes";

type Scope = "today" | "all";
const REASONS = [{ v: "stop", l: "Stop hit" }, { v: "target", l: "Target hit" }, { v: "time", l: "Time exit" }, { v: "other", l: "Other" }] as const;
const pnl = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}`);

export function Journal({ date }: { date: string }) {
  const [scope, setScope] = useState<Scope>("today");
  const q = useJournal(scope === "today" ? date : undefined);
  const csv = api.journalCsvUrl();
  const unsupported = q.error instanceof ApiError && q.error.code === "not_supported";

  return (
    <Panel title="Trade journal" description="Every taken and skipped setup, including the losers."
      actions={csv ? <a href={csv} className="text-xs text-accent underline" download>Download CSV</a> : null} bodyClassName="overflow-x-auto">
      <Segmented<Scope> label="Journal range" value={scope} onChange={setScope} options={[{ value: "today", label: "Today" }, { value: "all", label: "All" }]} />
      {unsupported ? (
        <StateMessage icon={BookOpen} tone="warn" title="This needs the real backend">The journal is stored by the backend, which demo mode does not have.</StateMessage>
      ) : q.isError ? (
        <StateMessage icon={BookOpen} tone="danger" title="Journal unavailable">{q.error instanceof Error ? q.error.message : "Something went wrong."}</StateMessage>
      ) : q.isPending ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : q.data.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing logged yet.</p>
      ) : (
        <table className="mt-3 w-full min-w-[44rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr><th className="py-2 pr-3 font-medium">Date</th><th className="px-3 font-medium">Symbol</th><th className="px-3 font-medium">Type</th><th className="px-3 font-medium">Entry / stop / target</th><th className="px-3 font-medium">Shares</th><th className="px-3 font-medium">Result</th><th className="pl-3" /></tr>
          </thead>
          <tbody className="divide-y divide-border">{q.data.map((e) => <Row key={e.id} e={e} />)}</tbody>
        </table>
      )}
    </Panel>
  );
}

function Row({ e }: { e: JournalEntry }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState<string>("stop");
  const [fees, setFees] = useState("0");
  const [net, setNet] = useState("");
  const upd = useUpdateJournal();
  const skipped = e.kind === "skipped";
  const needsExit = !skipped && e.exit_price == null;
  const valid = price.trim() !== "" && net.trim() !== "" && Number.isFinite(Number(price)) && Number.isFinite(Number(net)) && Number.isFinite(Number(fees));

  // PUT replaces every editable field, so resend the stored entry with the exit added.
  const { id: _id, created_at: _c, updated_at: _u, r_multiple: _r, ...stored } = e;
  const save = () => upd.mutate(
    { id: e.id, body: { ...stored, exit_price: Number(price), exit_reason: reason as "stop", fees: Number(fees), net_pnl: Number(net), exit_time: new Date().toISOString() } },
    { onSuccess: () => setOpen(false) },
  );

  return (
    <>
      <tr className="align-top">
        <td className="py-2 pr-3">{e.trade_date}</td>
        <td className="px-3 py-2 font-semibold">{e.symbol}</td>
        <td className="px-3 py-2"><Badge tone={skipped ? "neutral" : "info"}>{skipped ? "Skipped" : "Taken"}</Badge></td>
        <td className="px-3 py-2 text-xs">{skipped ? <span className="text-muted">{e.skip_reason ?? "—"}</span> : `${fmtPrice(e.entry)} / ${fmtPrice(e.stop)} / ${fmtPrice(e.target)}`}</td>
        <td className="px-3 py-2">{skipped ? "—" : e.shares ?? "—"}</td>
        <td className="px-3 py-2">{skipped ? "—" : e.net_pnl == null ? <span className="text-muted">Open</span> : <span className={e.net_pnl >= 0 ? "text-ok" : "text-danger"}>{pnl(e.net_pnl)}{e.r_multiple != null ? ` (${e.r_multiple.toFixed(2)}R)` : ""}</span>}</td>
        <td className="py-2 pl-3 text-right">{needsExit && <Button size="sm" onClick={() => setOpen(!open)}>{open ? "Cancel" : "Add exit"}</Button>}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="pb-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted">Exit price<input type="number" step="any" value={price} onChange={(x) => setPrice(x.target.value)} className="h-9 w-28 rounded-lg border border-border bg-surface px-2 text-sm text-fg" /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Why you exited
                <select value={reason} onChange={(x) => setReason(x.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-fg">{REASONS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">Fees ($)<input type="number" step="any" value={fees} onChange={(x) => setFees(x.target.value)} className="h-9 w-24 rounded-lg border border-border bg-surface px-2 text-sm text-fg" /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Net profit or loss ($)<input type="number" step="any" value={net} onChange={(x) => setNet(x.target.value)} className="h-9 w-32 rounded-lg border border-border bg-surface px-2 text-sm text-fg" /></label>
              <Button size="sm" variant="primary" disabled={!valid || upd.isPending} onClick={save}>{upd.isPending ? "Saving…" : "Save exit"}</Button>
            </div>
            {upd.isError && <p role="alert" className="mt-2 text-xs text-danger">{upd.error instanceof Error ? upd.error.message : "Could not save."}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
