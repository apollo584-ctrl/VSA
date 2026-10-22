"use client";

import { ArrowDownRight, ArrowUpRight, FlaskConical } from "lucide-react";
import { useState } from "react";
import { StateMessage } from "@/components/common/states";
import { Badge, Button, Panel, Segmented } from "@/components/ui/primitives";
import { useCollectIntraday, useIntraday, useOutcomes, useRunOutcomes } from "@/hooks/data";
import { fmtDateTime } from "@/lib/formatting";
import type { RawJobStatus, RawOutcomeBreakdown, RawOutcomeStat } from "@/lib/api/backend/schemas";

const words = (id: string) => id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const when = (iso?: string | null) => (iso ? fmtDateTime(Date.parse(iso) / 1000, true) : "never");
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

const GROUPS = [{ id: "vsa", title: "VSA signals" }, { id: "price", title: "Price patterns" }, { id: "momentum", title: "Momentum" }] as const;
const TREND_VALUES = [["up", "Uptrend"], ["down", "Downtrend"], ["flat", "Flat"]] as const;
const VOLUME_VALUES = [["low", "Low volume"], ["normal", "Normal volume"], ["high", "High volume"]] as const;

type Row = { concept: string; direction: RawOutcomeStat["direction"]; holds: boolean; older?: RawOutcomeStat; newer?: RawOutcomeStat };

export function OutcomesBoard() {
  const outcomes = useOutcomes();
  const run = useRunOutcomes();
  const [horizon, setHorizon] = useState("5");
  const [onlyHolds, setOnlyHolds] = useState(false);
  const [view, setView] = useState("results");

  if (outcomes.isError) {
    return <StateMessage icon={FlaskConical} tone="danger" title="Pattern stats unavailable">{errText(outcomes.error)}</StateMessage>;
  }
  if (outcomes.isPending) return <StateMessage icon={FlaskConical} title="Loading pattern stats…" />;
  const { status, study } = outcomes.data;

  const rows = new Map<string, Row>();
  for (const s of study?.stats ?? []) {
    if (String(s.horizon) !== horizon) continue;
    const r = rows.get(s.concept) ?? { concept: s.concept, direction: s.direction, holds: s.holds };
    r[s.period] = s;
    rows.set(s.concept, r);
  }
  const info = study?.concepts ?? {};
  const label = (id: string) => info[id]?.label ?? words(id);
  const shown = [...rows.values()].filter((r) => !onlyHolds || r.holds).sort((a, b) => a.concept.localeCompare(b.concept));
  const grouped = GROUPS.map((g) => ({ ...g, rows: shown.filter((r) => (info[r.concept]?.group ?? "vsa") === g.id) })).filter((g) => g.rows.length > 0);
  const breakdowns = (study?.breakdowns ?? []).filter((b) => String(b.horizon) === horizon);
  const minCases = study?.min_cases ?? 30;

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Daily outcome study" actions={<Button variant="primary" size="sm" disabled={status.running || run.isPending} onClick={() => run.mutate()}>{status.running ? "Running…" : "Run study"}</Button>}>
        <JobLine status={status} idle="No study has run yet. Press Run study." savedAt={study?.generated_at} />
        {study && <p className="mt-2 text-xs text-subtle">{study.symbols_used.length} symbols · {study.date_range.start} to {study.date_range.end} · older period ends {study.cutoff_date ?? "—"}</p>}
        {run.isError && <p role="alert" className="mt-3 text-sm text-danger">{errText(run.error)}</p>}
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted">
          <li>Hit rate is how often the price moved the signal&apos;s way over the chosen horizon. Compare it with the random-day baseline, which is the same measure over every day.</li>
          <li>Edge is hit rate minus baseline, in percentage points. Cases are independent signals, not bars.</li>
          <li>A setup only &quot;holds up&quot; if the older and newer periods agree. Past results are not a forecast.</li>
        </ul>
      </Panel>

      <Panel
        title="Results by signal"
        actions={
          <>
            <Segmented<string> label="Horizon" size="sm" value={horizon} onChange={setHorizon} options={(study?.horizons ?? [1, 5, 20]).map((h) => ({ value: String(h), label: `${h} day${h === 1 ? "" : "s"}` }))} />
            {(study?.breakdowns?.length ?? 0) > 0 && <Segmented<string> label="View" size="sm" value={view} onChange={setView} options={[{ value: "results", label: "Results" }, { value: "breakdown", label: "Where it works" }]} />}
            <Segmented<string> label="Filter" size="sm" value={onlyHolds ? "holds" : "all"} onChange={(v) => setOnlyHolds(v === "holds")} options={[{ value: "all", label: "All setups" }, { value: "holds", label: "Only setups that hold up" }]} />
          </>
        }
        bodyClassName="overflow-x-auto"
      >
        {!study
          ? <p className="text-sm text-muted">Results appear here after the study has run.</p>
          : shown.length === 0
            ? <p className="text-sm text-muted">{onlyHolds ? "No setups hold up at this horizon." : "No signals at this horizon."}</p>
            : grouped.map((g) => (
              <section key={g.id} aria-label={g.title} className="mb-6 last:mb-0">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h3>
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="text-xs text-muted">
                    {view === "breakdown"
                      ? <tr><th className="py-2 pr-3 font-medium">Signal</th>{[...TREND_VALUES, ...VOLUME_VALUES].map(([v, t]) => <th key={v} className="px-2 font-medium">{t}</th>)}</tr>
                      : <tr><th className="py-2 pr-3 font-medium">Signal</th><th className="px-3 font-medium">Older period</th><th className="px-3 font-medium">Newer period</th></tr>}
                  </thead>
                  <tbody className="divide-y divide-border">
                    {g.rows.map((r) => {
                      const strong = r.direction === "strength";
                      return (
                        <tr key={r.concept} className="align-top">
                          <td className="py-3 pr-3">
                            <div className="font-medium">{label(r.concept)}</div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <Badge tone={strong ? "ok" : "danger"}>{strong ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}{strong ? "Strength" : "Weakness"}</Badge>
                              {r.holds && <Badge tone="info">Holds up</Badge>}
                            </div>
                            {info[r.concept]?.description && <p className="mt-1 max-w-xs text-xs text-muted">{info[r.concept]?.description}</p>}
                          </td>
                          {view === "breakdown"
                            ? [...TREND_VALUES.map(([v]) => ["trend", v] as const), ...VOLUME_VALUES.map(([v]) => ["volume_bucket", v] as const)].map(([dim, v]) => (
                              <BreakdownCell key={`${dim}:${v}`} b={breakdowns.find((x) => x.concept === r.concept && x.dimension === dim && x.value === v)} />
                            ))
                            : <><Cell s={r.older} min={minCases} /><Cell s={r.newer} min={minCases} /></>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ))}
      </Panel>

      <IntradayCard />
    </div>
  );
}

function Cell({ s, min }: { s?: RawOutcomeStat; min: number }) {
  if (!s) return <td className="px-3 py-3 text-xs text-subtle">No cases</td>;
  const few = s.n_cases < min;
  const edge = 100 * s.edge;
  return (
    <td className={`px-3 py-3 ${few ? "opacity-50" : ""}`}>
      <div>Hit rate <span className="font-semibold">{pct(s.hit_rate)}</span> <span className="text-muted">vs random day {pct(s.baseline_hit_rate)}</span></div>
      <div className="text-xs text-muted">Edge {edge > 0 ? "+" : ""}{edge.toFixed(1)} pts · {s.n_cases} cases</div>
      {(s.t_stat != null || s.win_loss_ratio != null) && (
        <div className="text-xs text-muted">
          {s.t_stat != null && <>t-stat {s.t_stat.toFixed(1)}</>}{s.t_stat != null && s.win_loss_ratio != null && " · "}{s.win_loss_ratio != null && <>win/loss {s.win_loss_ratio.toFixed(2)}</>}
        </div>
      )}
      {few && <div className="text-xs text-warn">too few cases</div>}
    </td>
  );
}

function BreakdownCell({ b }: { b?: RawOutcomeBreakdown }) {
  if (!b) return <td className="px-2 py-3 text-xs text-subtle">—</td>;
  const edge = 100 * b.edge;
  return (
    <td className="px-2 py-3">
      <div className="font-semibold">{pct(b.hit_rate)}</div>
      <div className="text-xs text-muted">{edge > 0 ? "+" : ""}{edge.toFixed(1)} pts · {b.n_cases}</div>
    </td>
  );
}

function JobLine({ status, idle, savedAt }: { status: RawJobStatus; idle: string; savedAt?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted" aria-live="polite">
      {status.running ? <span>Running: {status.done} of {status.total} symbols…</span> : status.finished_at ? <span>Last run finished {when(status.finished_at)}</span> : savedAt ? <span>Showing saved results from {when(savedAt)}</span> : <span>{idle}</span>}
      {status.errors > 0 && <span>{status.errors} symbols could not be loaded</span>}
      {status.error && <span role="alert" className="text-danger">Error: {status.error}</span>}
    </div>
  );
}

function IntradayCard() {
  const intraday = useIntraday();
  const collect = useCollectIntraday();
  const d = intraday.data;
  return (
    <Panel title="30-minute history saver" actions={<Button size="sm" disabled={d?.status.running || collect.isPending} onClick={() => collect.mutate()}>{d?.status.running ? "Collecting…" : "Collect now"}</Button>}>
      {intraday.isError
        ? <p role="alert" className="text-sm text-danger">{errText(intraday.error)}</p>
        : !d
          ? <p className="text-sm text-muted">Loading…</p>
          : (
            <>
              <JobLine status={d.status} idle="Nothing collected yet. Press Collect now." savedAt={d.summary.last_collected_at} />
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <Stat k="Bars saved" v={d.summary.bars.toLocaleString()} />
                <Stat k="Symbols" v={String(d.summary.symbols)} />
                <Stat k="Rebased symbols" v={String(d.summary.rebased_symbols)} />
                <Stat k="First bar" v={d.summary.first_ts ? when(d.summary.first_ts) : "—"} />
                <Stat k="Last bar" v={d.summary.last_ts ? when(d.summary.last_ts) : "—"} />
                <Stat k="Last collected" v={when(d.summary.last_collected_at)} />
              </dl>
            </>
          )}
      {collect.isError && <p role="alert" className="mt-3 text-sm text-danger">{errText(collect.error)}</p>}
      <p className="mt-3 text-xs leading-relaxed text-muted">Free data sources only give about 60 days of 30-minute bars, so each collection adds the newest bars to our own saved history. It grows over time and is not a forecast. Rebased symbols had their price history adjusted (for example after a split); old rows are kept.</p>
    </Panel>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => <div><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>;
