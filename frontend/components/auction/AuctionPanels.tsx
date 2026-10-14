"use client";

import { ArrowDown } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { StateMessage } from "@/components/common/states";
import { Badge, SectionLabel } from "@/components/ui/primitives";
import { AUCTION_LABELS, fmtDateTime, fmtPrice, humanize } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import type { AuctionState, AuctionTransition, DetailLevel } from "@/types";
import { Workflow } from "lucide-react";

/** Proportional strip of the chronological state sequence. */
export function StateStrip({ states, selectedStateId, onSelect }: { states: AuctionState[]; selectedStateId: string | null; onSelect: (id: string) => void }) {
  if (!states.length) return null;
  const last = states[states.length - 1]!;
  const t0 = states[0]!.startTime;
  const tEnd = last.endTime ?? last.startTime + Math.max(1800, (last.startTime - t0) * 0.08);
  const total = Math.max(1, tEnd - t0);
  return (
    <ol className="flex h-10 w-full gap-0.5" aria-label="Auction state timeline">
      {states.map((s) => {
        const end = s.endTime ?? tEnd;
        const w = Math.max(4, ((end - s.startTime) / total) * 100);
        return (
          <li key={s.id} style={{ flexBasis: `${w}%`, flexGrow: w }} className="min-w-14">
            <button
              type="button" onClick={() => onSelect(s.id)} aria-pressed={selectedStateId === s.id}
              title={`${AUCTION_LABELS[s.kind]} — ${s.summary}`}
              className={cn("h-full w-full truncate rounded border px-1.5 text-left text-[11px] transition-colors", selectedStateId === s.id ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-2 hover:bg-surface-3", s.endTime === null && "border-dashed")}
            >
              {AUCTION_LABELS[s.kind]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Vertical flow diagram: states connected by clickable transitions. */
export function StateFlow({ states, transitions, selectedTransitionId, onSelect }: {
  states: AuctionState[]; transitions: AuctionTransition[]; selectedTransitionId: string | null; onSelect: (id: string) => void;
}) {
  if (!states.length) {
    return <StateMessage icon={Workflow} title="No auction states available">The engine has not classified any auction state as of this point.</StateMessage>;
  }
  const byTo = new Map(transitions.map((t) => [t.toStateId, t]));
  return (
    <ol className="flex flex-col items-stretch" aria-label="Auction state transitions">
      {states.map((s, i) => {
        const tr = byTo.get(s.id);
        const current = s.endTime === null;
        return (
          <Fragment key={s.id}>
            {tr && i > 0 && (
              <li className="flex items-center justify-center py-0.5">
                <button
                  type="button" onClick={() => onSelect(tr.id)} aria-pressed={selectedTransitionId === tr.id}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors", selectedTransitionId === tr.id ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:bg-surface-2 hover:text-fg")}
                >
                  <ArrowDown size={12} aria-hidden /> Transition · {fmtDateTime(tr.at)} · view evidence
                </button>
              </li>
            )}
            <li className={cn("rounded-md border px-3 py-2", current ? "border-accent/60 bg-accent-soft" : "border-border bg-surface-2")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold">{AUCTION_LABELS[s.kind]}</span>
                {current && <Badge tone="info">Current</Badge>}
                <span className="text-[11px] text-subtle">{fmtDateTime(s.startTime)} → {s.endTime ? fmtDateTime(s.endTime) : "ongoing"}</span>
                {s.priceLow !== undefined && s.priceHigh !== undefined && <span className="num text-[11px] text-subtle">{fmtPrice(s.priceLow)}–{fmtPrice(s.priceHigh)}</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted">{s.summary}</p>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

export function TransitionDetail({ transition, from, to, level }: { transition: AuctionTransition | null; from: AuctionState | null; to: AuctionState | null; level: DetailLevel }) {
  if (!transition || !to) {
    return <StateMessage title="Select a transition">Choose a transition in the diagram to see the evidence behind the classification.</StateMessage>;
  }
  return (
    <article className="space-y-3 text-xs leading-relaxed">
      <h3 className="text-sm font-semibold">{from ? AUCTION_LABELS[from.kind] : "Start"} → {AUCTION_LABELS[to.kind]}</h3>
      <p className="text-subtle">At {fmtDateTime(transition.at, true)} · classified when {fmtDateTime(transition.detectedAt, true)}</p>
      <section><SectionLabel>Why the engine classified it</SectionLabel><p>{transition.rationale}</p></section>
      {level !== "quick" && (
        <section>
          <SectionLabel>Evidence</SectionLabel>
          <ul className="space-y-1.5">
            {transition.evidence.map((e) => (
              <li key={e.id} className="rounded border border-border bg-surface-2 px-2 py-1">
                <span className="mr-1 text-[10px] uppercase tracking-wide text-subtle">{humanize(e.kind)}</span>{e.text}
                {e.measurement && <span className="num text-subtle"> [{e.measurement}]</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {level === "deep" && <Link href="/knowledge/auction-acceptance-vs-excursion" className="text-accent hover:underline">Acceptance vs. excursion →</Link>}
    </article>
  );
}

export function AcceptanceExplainer() {
  return (
    <div className="space-y-2 text-xs leading-relaxed">
      <p><b>Excursion:</b> price briefly trades beyond a level (e.g., above the prior value area high), then may return.</p>
      <p><b>Acceptance:</b> time and volume build beyond the level — typically several bars trading <i>and closing</i> there, with later trade remaining. Acceptance is established gradually, not at the first touch.</p>
      <p className="text-muted">The thresholds used are conventions defined by the engine; different thresholds can classify the same history differently.</p>
      <Link href="/knowledge/auction-acceptance-vs-excursion" className="text-accent hover:underline">Learn more →</Link>
    </div>
  );
}
