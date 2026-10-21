"use client";

import { ArrowDownRight, ArrowUpRight, BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StateMessage } from "@/components/common/states";
import { Badge, Button, Panel, Segmented } from "@/components/ui/primitives";
import { useAlertStatus, useAlerts, useLoadSymbol, useRunAlerts, useTrackRecord } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";
import { fmtDateTime } from "@/lib/formatting";
import type { RawAlert, RawTrackRow } from "@/lib/api/backend/schemas";

const words = (id: string) => id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const signedPct = (x: number) => `${x > 0 ? "+" : ""}${(100 * x).toFixed(2)}%`;
const when = (iso?: string | null) => (iso ? fmtDateTime(Date.parse(iso) / 1000, true) : "never");
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const dir = (d: string) => d === "strength";

type Tab = "today" | "record";

export function SignalsBoard() {
  const [tab, setTab] = useState<Tab>("today");
  return (
    <div className="flex flex-col gap-6">
      <Segmented<Tab> label="Signals view" value={tab} onChange={setTab} options={[{ value: "today", label: "Today" }, { value: "record", label: "Track record" }]} />
      {tab === "today" ? <Today /> : <Record />}
    </div>
  );
}

function Today() {
  const alerts = useAlerts();
  const status = useAlertStatus();
  const run = useRunAlerts();
  const load = useLoadSymbol();
  const { selectInstrument } = useWorkspace();
  const router = useRouter();
  const [opening, setOpening] = useState<string | null>(null);

  if (alerts.isError) return <StateMessage icon={BellRing} tone="danger" title="Signals unavailable">{errText(alerts.error)}</StateMessage>;
  if (alerts.isPending) return <StateMessage icon={BellRing} title="Loading signals…" />;
  const { session, alerts: list, last_run } = alerts.data;
  const s = status.data;
  const running = !!s?.running;

  const open = (symbol: string) => {
    setOpening(symbol);
    load.mutate(symbol, { onSuccess: ({ datasetId }) => { selectInstrument(datasetId); router.push("/chart"); }, onSettled: () => setOpening(null) });
  };

  return (
    <Panel title="Today's setups" actions={<Button variant="primary" size="sm" disabled={running || run.isPending} onClick={() => run.mutate()}>{running ? "Running…" : "Run now"}</Button>} bodyClassName="overflow-x-auto">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted" aria-live="polite">
        <span>Session {session ?? "—"}</span>
        <span>Last run {when(last_run?.at)}</span>
        {!!last_run?.skipped_sessions && <span className="text-warn">{last_run.skipped_sessions} weekday{last_run.skipped_sessions === 1 ? "" : "s"} not logged since {last_run.previous_session} (app was off; not filled in afterwards)</span>}
        {!!last_run?.fetch_errors && <span className="text-warn">{last_run.fetch_errors} symbols failed to download; Run now retries them</span>}
        {running && <span>Running: {s?.done} of {s?.total} symbols…</span>}
        {s?.error && <span role="alert" className="text-danger">Error: {s.error}</span>}
      </div>
      {run.isError && <p role="alert" className="mt-3 text-sm text-danger">{errText(run.error)}</p>}
      {load.isError && <p role="alert" className="mt-3 text-sm text-danger">{errText(load.error)}</p>}
      {list.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{last_run ? "No setups today" : "No alerts yet — run the study first, then Run now"}</p>
      ) : (
        <table className="mt-3 w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr><th className="py-2 pr-3 font-medium">Symbol</th><th className="px-3 font-medium">Setup</th><th className="px-3 font-medium">Direction</th><th className="px-3 font-medium">Study edge by horizon</th><th className="pl-3" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.map((a) => <AlertRow key={`${a.symbol}-${a.concept}`} a={a} opening={opening === a.symbol} onOpen={() => open(a.symbol)} />)}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function AlertRow({ a, opening, onOpen }: { a: RawAlert; opening: boolean; onOpen: () => void }) {
  const strong = dir(a.direction);
  return (
    <tr className="align-top">
      <td className="py-3 pr-3 font-semibold">{a.symbol}</td>
      <td className="px-3 py-3">{words(a.concept)}</td>
      <td className="px-3 py-3"><Badge tone={strong ? "ok" : "danger"}>{strong ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}{strong ? "Strength" : "Weakness"}</Badge></td>
      <td className="px-3 py-3 text-xs">
        {(a.study_newer ?? []).length === 0 ? <span className="text-subtle">—</span> : (a.study_newer ?? []).map((n) => (
          <div key={n.horizon}>{n.horizon}d: hit {pct(n.hit_rate)} · edge {n.edge > 0 ? "+" : ""}{(100 * n.edge).toFixed(1)} pts</div>
        ))}
      </td>
      <td className="py-3 pl-3 text-right"><Button size="sm" disabled={opening} onClick={onOpen}>{opening ? "Opening…" : "Load chart"}</Button></td>
    </tr>
  );
}

function Record() {
  const rec = useTrackRecord();
  if (rec.isError) return <StateMessage icon={BellRing} tone="danger" title="Track record unavailable">{errText(rec.error)}</StateMessage>;
  if (rec.isPending) return <StateMessage icon={BellRing} title="Loading track record…" />;
  const { rows, round_trip_cost } = rec.data;
  return (
    <Panel title="Track record" bodyClassName="overflow-x-auto">
      <p className="text-xs text-muted">Results are history, not a forecast. Net return subtracts a round-trip cost of {(100 * round_trip_cost).toFixed(2)}%.</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No scored alerts yet. Results appear after alerts have been saved and had time to play out.</p>
      ) : (
        <table className="mt-3 w-full min-w-[44rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr><th className="py-2 pr-3 font-medium">Setup</th><th className="px-3 font-medium">Horizon</th><th className="px-3 font-medium">Cases</th><th className="px-3 font-medium">Hit rate</th><th className="px-3 font-medium">Baseline</th><th className="px-3 font-medium">Mean return</th><th className="px-3 font-medium">Net of cost</th><th className="pl-3 font-medium">Verdict</th></tr>
          </thead>
          <tbody className="divide-y divide-border">{rows.map((r) => <RecordRow key={`${r.concept}-${r.horizon}`} r={r} />)}</tbody>
        </table>
      )}
    </Panel>
  );
}

function RecordRow({ r }: { r: RawTrackRow }) {
  const few = r.verdict === "too few cases yet";
  const strong = dir(r.direction);
  return (
    <tr className="align-top">
      <td className="py-3 pr-3">
        <div className="font-medium">{words(r.concept)}</div>
        <Badge tone={strong ? "ok" : "danger"}>{strong ? "Strength" : "Weakness"}</Badge>
      </td>
      <td className="px-3 py-3">{r.horizon}d</td>
      <td className="px-3 py-3">{r.n}</td>
      <td className="px-3 py-3 font-semibold">{few ? <span className="text-subtle">—</span> : pct(r.hit_rate)}</td>
      <td className="px-3 py-3 text-muted">{r.baseline_hit_rate == null ? "—" : pct(r.baseline_hit_rate)}</td>
      <td className="px-3 py-3">{signedPct(r.mean_return)}</td>
      <td className="px-3 py-3">{signedPct(r.mean_return_net)}</td>
      <td className="py-3 pl-3 text-xs">{few ? <span className="text-warn">{r.verdict}</span> : <span className="text-muted">{r.verdict}</span>}</td>
    </tr>
  );
}
