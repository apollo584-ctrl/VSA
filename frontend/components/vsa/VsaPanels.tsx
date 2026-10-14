"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { ClassificationBadge, HypothesisBadge, ObservationBadge, StatusBadge } from "@/components/common/badges";
import { NoPatternsState } from "@/components/common/states";
import { Badge, KeyValue, SectionLabel, Term } from "@/components/ui/primitives";
import { fmtDateTime, fmtMultiple, fmtPrice, humanize, patternCode, patternLabel } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import type { DetailLevel, VsaEvent } from "@/types";

export function VsaEventList({ events, selectedId, onSelect, scopeLabel }: { events: VsaEvent[]; selectedId: string | null; onSelect: (id: string | null) => void; scopeLabel?: string }) {
  if (!events.length) return <NoPatternsState scope={scopeLabel} />;
  const sorted = [...events].sort((a, b) => b.barTime - a.barTime);
  return (
    <ul className="flex flex-col gap-1" aria-label="Detected VSA observations">
      {sorted.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => onSelect(e.id === selectedId ? null : e.id)}
            aria-pressed={e.id === selectedId}
            className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors", e.id === selectedId ? "border-accent bg-accent-soft" : "border-border bg-surface-2 hover:bg-surface-3")}
          >
            <span aria-hidden className="num grid h-5 w-7 shrink-0 place-items-center rounded border border-border-strong text-[10px] text-vsa">{patternCode(e.type)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{patternLabel(e.type)}</span>
              <span className="block text-[11px] text-subtle">{fmtDateTime(e.barTime)} · vol {fmtMultiple(e.measurements.relativeVolume)}</span>
            </span>
            <StatusBadge status={e.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function CloseLocation({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-subtle">not provided</span>;
  return (
    <div className="flex items-center gap-2" title={`Close location ${value.toFixed(2)} (0 = low, 1 = high)`}>
      <span className="relative h-2 w-24 rounded bg-surface-3" aria-hidden>
        <span className="absolute top-[-2px] h-3 w-1 rounded bg-fg" style={{ left: `calc(${value * 100}% - 2px)` }} />
      </span>
      <span className="num">{value.toFixed(2)}</span>
    </div>
  );
}

const list = (items: string[], muted = false) => (
  <ul className={cn("list-disc space-y-0.5 pl-4", muted && "text-muted")}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
);

/** Detail panel for a single VSA event; depth follows the global explanation mode. */
export function VsaDetailPanel({ event, level, onClose }: { event: VsaEvent; level: DetailLevel; onClose?: () => void }) {
  const m = event.measurements;
  return (
    <article className="space-y-3 text-xs leading-relaxed" aria-label={`${patternLabel(event.type)} details`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{patternLabel(event.type)}</h3>
        <StatusBadge status={event.status} />
        <span className="text-subtle">{fmtDateTime(event.barTime, true)}</span>
        {event.direction && <Badge tone="neutral" title="Contextual label from the rules. It is not a trade instruction.">context: {event.direction}</Badge>}
        {onClose && <button type="button" onClick={onClose} className="ml-auto text-subtle hover:text-fg">Clear selection</button>}
      </header>

      <section>
        <div className="mb-1 flex items-center gap-2"><SectionLabel>What was observed</SectionLabel>{event.kind === "classified" ? <ClassificationBadge /> : <ObservationBadge />}</div>
        {event.description && <p className="mb-1 text-muted">{event.description}</p>}
        <dl>
          <KeyValue k={<Term hint="High minus low of the bar, and relative to its prior-bar baseline spread.">Candle spread</Term>} v={m.spread == null ? "not provided" : `${fmtPrice(m.spread)}${m.spreadVsAvg != null ? ` (${fmtMultiple(m.spreadVsAvg)} baseline)` : ""}`} />
          <KeyValue k={<Term hint="Bar volume divided by its prior-bar baseline volume.">Relative volume</Term>} v={m.relativeVolume == null ? "not provided" : fmtMultiple(m.relativeVolume)} />
          <KeyValue k={<Term hint="Where the close sits within the bar: 0 = at the low, 1 = at the high.">Close location</Term>} v={<CloseLocation value={m.closeLocation} />} />
          <KeyValue k="Background trend" v={m.priorTrend ? humanize(m.priorTrend) : "not provided"} />
          <KeyValue k="Price location" v={<span className="font-sans">{m.priceLocation ?? "not provided by the engine"}</span>} />
        </dl>
      </section>

      {level !== "quick" && (
        <section>
          <SectionLabel>{event.textSource === "catalog" ? "Rule conditions (from the knowledge catalog)" : "Why the engine identified it"}</SectionLabel>
          {event.textSource === "catalog" && <p className="mb-1 text-[11px] text-subtle">The engine does not report which individual conditions were satisfied for this observation. These are the catalog's generic conditions for the concept.</p>}
          <ul className="space-y-1">
            {event.conditions.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5">
                {c.met === true ? <Check size={13} aria-label="Condition met" className="mt-0.5 shrink-0 text-ok" /> : c.met === false ? <Minus size={13} aria-label="Condition not met" className="mt-0.5 shrink-0 text-warn" /> : <span aria-hidden className="mt-0.5 shrink-0 text-subtle">•</span>}
                <span><span className="font-medium">{c.label}</span>{c.detail && <span className="text-muted"> — {c.detail}</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-1 flex items-center gap-2"><SectionLabel>What it may imply</SectionLabel><HypothesisBadge /></div>
        {event.implications.length ? list(level === "quick" ? event.implications.slice(0, 1) : event.implications) : <p className="text-subtle">No interpretations supplied.</p>}
        {event.textSource === "catalog" && level !== "quick" && <p className="mt-1 text-[11px] text-subtle">Generic for this concept (knowledge catalog); not specific to this bar.</p>}
      </section>

      {level !== "quick" && (
        <>
          <section><SectionLabel>Alternative explanations</SectionLabel>{list(event.alternatives, true)}</section>
          <section className="grid gap-3 sm:grid-cols-2">
            <div><SectionLabel>What would confirm it</SectionLabel>{list(event.confirmation)}</div>
            <div><SectionLabel>What would invalidate it</SectionLabel>{list(event.invalidation)}</div>
          </section>
        </>
      )}

      {level === "deep" && (
        <>
          <section>
            <SectionLabel>Detection status history</SectionLabel>
            <ol className="space-y-1 border-l border-border pl-3">
              {event.statusHistory.map((h, i) => (
                <li key={i}><StatusBadge status={h.status} /> <span className="text-subtle">{fmtDateTime(h.at, true)}</span>{h.reason && <span className="text-muted"> — {h.reason}</span>}</li>
              ))}
            </ol>
            <p className="mt-1 text-[11px] text-subtle">Only status changes known at the analysis time are shown.</p>
          </section>
          {event.measurements.raw && (
            <section>
              <SectionLabel>All reported measurements</SectionLabel>
              <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {Object.entries(event.measurements.raw).map(([k, v]) => <KeyValue key={k} k={humanize(k)} v={v === null ? "—" : typeof v === "number" ? Number(v.toPrecision(5)) : v} />)}
              </dl>
            </section>
          )}
          {event.referencePrices.length > 0 && <section><SectionLabel>Reference prices</SectionLabel><p className="num">{event.referencePrices.map((p) => fmtPrice(p)).join(" · ")}</p></section>}
          {event.profileRefs.length > 0 && <section><SectionLabel>Linked profile references</SectionLabel><div className="flex flex-wrap gap-1">{event.profileRefs.map((r) => <Badge key={r}>{r.replace(/_/g, " ")}</Badge>)}</div></section>}
        </>
      )}

      {level !== "quick" && event.knowledgeSlugs.length > 0 && (
        <footer className="flex flex-wrap gap-2 border-t border-border pt-2">
          {event.knowledgeSlugs.map((s) => <Link key={s} href={`/knowledge/${s}`} className="text-accent hover:underline">{humanize(s.replace(/^(vsa|auction|profile-shape)-/, ""))} →</Link>)}
        </footer>
      )}
    </article>
  );
}
