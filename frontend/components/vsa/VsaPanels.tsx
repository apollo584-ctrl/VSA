"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { HypothesisBadge, ObservationBadge, StatusBadge } from "@/components/common/badges";
import { NoPatternsState } from "@/components/common/states";
import { Badge, KeyValue, SectionLabel, Term } from "@/components/ui/primitives";
import { PATTERN_CODES, PATTERN_LABELS, fmtDateTime, fmtMultiple, fmtPrice, humanize } from "@/lib/formatting";
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
            <span aria-hidden className="num grid h-5 w-7 shrink-0 place-items-center rounded border border-border-strong text-[10px] text-vsa">{PATTERN_CODES[e.type]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{PATTERN_LABELS[e.type]}</span>
              <span className="block text-[11px] text-subtle">{fmtDateTime(e.barTime)} · vol {fmtMultiple(e.measurements.relativeVolume)}</span>
            </span>
            <StatusBadge status={e.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function CloseLocation({ value }: { value: number }) {
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
    <article className="space-y-3 text-xs leading-relaxed" aria-label={`${PATTERN_LABELS[event.type]} details`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{PATTERN_LABELS[event.type]}</h3>
        <StatusBadge status={event.status} />
        <span className="text-subtle">{fmtDateTime(event.barTime, true)}</span>
        {onClose && <button type="button" onClick={onClose} className="ml-auto text-subtle hover:text-fg">Clear selection</button>}
      </header>

      <section>
        <div className="mb-1 flex items-center gap-2"><SectionLabel>What was observed</SectionLabel><ObservationBadge /></div>
        <dl>
          <KeyValue k={<Term hint="High minus low of the bar, and relative to the 20-bar average spread.">Candle spread</Term>} v={`${fmtPrice(m.spread)} (${fmtMultiple(m.spreadVsAvg)} avg)`} />
          <KeyValue k={<Term hint="Bar volume divided by trailing average volume.">Relative volume</Term>} v={fmtMultiple(m.relativeVolume)} />
          <KeyValue k={<Term hint="Where the close sits within the bar: 0 = at the low, 1 = at the high.">Close location</Term>} v={<CloseLocation value={m.closeLocation} />} />
          <KeyValue k="Prior trend" v={humanize(m.priorTrend)} />
          <KeyValue k="Price location" v={<span className="font-sans">{m.priceLocation}</span>} />
        </dl>
      </section>

      {level !== "quick" && (
        <section>
          <SectionLabel>Why the engine identified it</SectionLabel>
          <ul className="space-y-1">
            {event.conditions.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5">
                {c.met ? <Check size={13} aria-label="Condition met" className="mt-0.5 shrink-0 text-ok" /> : <Minus size={13} aria-label="Condition not met" className="mt-0.5 shrink-0 text-warn" />}
                <span><span className="font-medium">{c.label}</span> <span className="text-muted">— {c.detail}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-1 flex items-center gap-2"><SectionLabel>What it may imply</SectionLabel><HypothesisBadge /></div>
        {list(level === "quick" ? event.implications.slice(0, 1) : event.implications)}
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
