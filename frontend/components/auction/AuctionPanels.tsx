"use client";

import { locationReason } from "@/lib/location";
import { ArrowDown } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { StateMessage } from "@/components/common/states";
import { Badge, SectionLabel } from "@/components/ui/primitives";
import { auctionLabel, fmtDateTime, fmtPrice, humanize } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import type { AuctionReset, AuctionState, AuctionTransition, DetailLevel } from "@/types";
import { Workflow } from "lucide-react";

/** Colour family per state, so a long sequence reads at a glance. Not a directional signal. */
const STATE_FAMILY: { test: (k: string) => boolean; label: string; color: string; opacity: number }[] = [
  { test: (k) => k === "higher_price_acceptance", label: "Higher-price acceptance", color: "var(--up)", opacity: 1 },
  { test: (k) => k === "upward_breakout_attempt", label: "Upward attempt", color: "var(--up)", opacity: 0.45 },
  { test: (k) => k === "lower_price_acceptance", label: "Lower-price acceptance", color: "var(--down)", opacity: 1 },
  { test: (k) => k === "downward_breakout_attempt", label: "Downward attempt", color: "var(--down)", opacity: 0.45 },
  { test: (k) => k.startsWith("rejection"), label: "Rejection", color: "var(--warn)", opacity: 0.85 },
  { test: (k) => k === "balance", label: "Balance", color: "var(--value)", opacity: 0.75 },
];
const familyOf = (kind: string) => STATE_FAMILY.find((f) => f.test(kind)) ?? { label: "Other / indeterminate", color: "var(--fg-subtle)", opacity: 0.5 };

const etDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });

/** Proportional colour bar of the chronological state sequence, with a legend. Each segment is a button. */
export function StateStrip({ states, selectedStateId, onSelect }: { states: AuctionState[]; selectedStateId: string | null; onSelect: (id: string) => void }) {
  if (!states.length) return null;
  const last = states[states.length - 1]!;
  const t0 = states[0]!.startTime;
  // An ongoing state is drawn one 30-minute slot wide; its real end is unknown.
  const tEnd = last.endTime ?? last.startTime + 1800;
  const families = [...new Map(states.map((s) => familyOf(s.kind)).map((f) => [f.label, f])).values()];
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs text-subtle"><span>{fmtDateTime(t0, true)}</span><span>{last.endTime ? fmtDateTime(last.endTime, true) : "now"}</span></div>
      <ol className="flex h-6 w-full overflow-hidden rounded-full bg-surface-2" aria-label="Auction state timeline">
        {states.map((s) => {
          const f = familyOf(s.kind);
          const w = Math.max(0.4, (s.endTime ?? tEnd) - s.startTime);
          const selected = selectedStateId === s.id;
          return (
            <li key={s.id} style={{ flexGrow: w, flexBasis: 0 }} className="min-w-[3px] border-r border-surface last:border-0">
              <button
                type="button" onClick={() => onSelect(s.id)} aria-pressed={selected}
                aria-label={`${auctionLabel(s.kind)}, ${fmtDateTime(s.startTime)}${s.endTime ? ` to ${fmtDateTime(s.endTime)}` : ", ongoing"}`}
                title={`${auctionLabel(s.kind)} · ${fmtDateTime(s.startTime)} → ${s.endTime ? fmtDateTime(s.endTime) : "ongoing"}`}
                className={cn("block h-full w-full transition-opacity hover:opacity-100", selected && "ring-2 ring-inset ring-fg")}
                style={{ background: f.color, opacity: selected ? 1 : f.opacity }}
              />
            </li>
          );
        })}
      </ol>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legend">
        {families.map((f) => (
          <li key={f.label} className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: f.color, opacity: f.opacity }} />{f.label}</li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical flow, grouped by session: states connected by clickable transitions. */
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
        const day = etDate.format(s.startTime * 1000);
        const newDay = i === 0 || etDate.format(states[i - 1]!.startTime * 1000) !== day;
        const f = familyOf(s.kind);
        return (
          <Fragment key={s.id}>
            {newDay && <li className={cn("sticky top-0 z-10 bg-surface pb-2 text-xs font-semibold text-subtle", i > 0 && "mt-4 pt-2")}>{day}</li>}
            {tr && !newDay && (
              <li className="flex items-center justify-center py-1">
                <button
                  type="button" onClick={() => onSelect(tr.id)} aria-pressed={selectedTransitionId === tr.id}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors", selectedTransitionId === tr.id ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:bg-surface-2 hover:text-fg")}
                >
                  <ArrowDown size={13} aria-hidden /> {fmtDateTime(tr.at)} · view evidence
                </button>
              </li>
            )}
            <li className={cn("flex gap-3 rounded-lg border px-4 py-3", current ? "border-accent/50 bg-accent-soft" : "border-border bg-surface-2")}>
              <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: f.color, opacity: Math.max(0.6, f.opacity) }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold">{auctionLabel(s.kind)}</span>
                  {current && <Badge tone="info">Current</Badge>}
                  <span className="num text-xs text-subtle">{fmtDateTime(s.startTime)} → {s.endTime ? fmtDateTime(s.endTime) : "ongoing"}</span>
                  {s.priceLow !== undefined && s.priceHigh !== undefined && <span className="num text-xs text-subtle">value {fmtPrice(s.priceLow)}–{fmtPrice(s.priceHigh)}</span>}
                  {tr && newDay && (
                    <button type="button" onClick={() => onSelect(tr.id)} aria-pressed={selectedTransitionId === tr.id} className={cn("ml-auto text-xs hover:underline", selectedTransitionId === tr.id ? "text-accent" : "text-muted")}>view evidence</button>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{s.summary}</p>
              </div>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/** The generic "indeterminate" label explains a missing prior session, which is wrong for a reset. */
const resetStateLabel = (kind: string) => (kind === "indeterminate" ? "Indeterminate" : auctionLabel(kind));

/** Session boundaries where the engine restarted auction state. These are not market-driven transitions. */
export function SessionResets({ resets }: { resets: AuctionReset[] | null | undefined }) {
  if (!resets) {
    return <p className="text-xs text-subtle">This saved analysis did not record session resets. None are inferred.</p>;
  }
  if (!resets.length) return <p className="text-xs text-subtle">No session boundary occurs within the analysed bars.</p>;
  return (
    <ol className="space-y-1.5" aria-label="Auction session resets">
      {resets.map((r) => (
        <li key={r.id} className="rounded border border-dashed border-border-strong bg-surface-2 px-2.5 py-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Session reset</Badge>
            <span className="font-semibold">{r.session}</span>
            <span className="text-xs text-subtle">first bar {fmtDateTime(r.at, true)} · observable {fmtDateTime(r.observableAt, true)}</span>
          </div>
          <p className="mt-0.5 text-muted">
            Auction state restarted from {resetStateLabel(r.previousState)} (session {r.previousSession}) to Indeterminate. {r.referenceUsable && r.referenceSession
              ? `Reference: prior session ${r.referenceSession} value area.`
              : `No usable prior value: ${locationReason(r.referenceUnavailableReason)}.`}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function TransitionDetail({ transition, from, to, level }: { transition: AuctionTransition | null; from: AuctionState | null; to: AuctionState | null; level: DetailLevel }) {
  if (!transition || !to) {
    return <StateMessage title="Select a transition">Choose a transition in the diagram to see the evidence behind the classification.</StateMessage>;
  }
  return (
    <article className="space-y-3 text-xs leading-relaxed">
      <h3 className="text-sm font-semibold">{from ? auctionLabel(from.kind) : "Start"} → {auctionLabel(to.kind)}</h3>
      <p className="text-subtle">At {fmtDateTime(transition.at, true)} · classified when {fmtDateTime(transition.detectedAt, true)}</p>
      <section><SectionLabel>Why the engine classified it</SectionLabel><p>{transition.rationale}</p></section>
      {level !== "quick" && (
        <section>
          <SectionLabel>Evidence</SectionLabel>
          <ul className="space-y-1.5">
            {transition.evidence.map((e) => (
              <li key={e.id} className="rounded border border-border bg-surface-2 px-2 py-1">
                <span className="mr-1 text-xs text-subtle">{humanize(e.kind)}</span>{e.text}
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
