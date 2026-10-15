"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { ClassificationBadge, HypothesisBadge, ObservationBadge } from "@/components/common/badges";
import { MixedEvidenceNotice, StateMessage } from "@/components/common/states";
import { Badge, SectionLabel, Segmented } from "@/components/ui/primitives";
import { useWorkspace } from "@/hooks/workspace";
import { fmtDateTime, humanize } from "@/lib/formatting";
import { evidenceSummary } from "@/lib/evidenceSummary";
import { cn } from "@/lib/utils";
import type { Analysis, DetailLevel, EvidenceItem, Interpretation, Narrative } from "@/types";
import { FileQuestion } from "lucide-react";

export function DetailLevelSwitch() {
  const { state, set } = useWorkspace();
  return (
    <Segmented<DetailLevel>
      label="Explanation depth" value={state.detailLevel} onChange={(v) => set({ detailLevel: v })} size="sm"
      options={[
        { value: "quick", label: "Quick", title: "Concise summary" },
        { value: "standard", label: "Standard", title: "Contextual explanation" },
        { value: "deep", label: "Deep", title: "Full reasoning, measurements and references" },
      ]}
    />
  );
}

/** Renders a narrative at the chosen depth. Depth changes presentation only — never the facts. */
export function NarrativeText({ n, level }: { n: Narrative | null; level: DetailLevel }) {
  if (!n) return <p className="text-subtle">Not provided by the analysis engine.</p>;
  if (level === "quick") return <p>{n.quick}</p>;
  return (
    <div className="space-y-1">
      <p>{n.standard}</p>
      {level === "deep" && n.deep.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-muted num [&>li]:font-sans">{n.deep.map((d, i) => <li key={i}>{d}</li>)}</ul>}
    </div>
  );
}

function EvidenceList({ items, tone }: { items: EvidenceItem[]; tone: "support" | "contradict" }) {
  if (!items.length) return <p className="text-subtle">None identified.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((e) => (
        <li key={e.id} className="flex items-start gap-1.5">
          {tone === "support" ? <ArrowUpRight size={13} aria-label="Supports" className="mt-0.5 shrink-0 text-muted" /> : <ArrowDownRight size={13} aria-label="Contradicts" className="mt-0.5 shrink-0 text-warn" />}
          <span>
            {e.text} {e.measurement && <span className="num text-subtle">[{e.measurement}]</span>}
            <span className="ml-1 text-xs text-subtle">{humanize(e.kind)}</span>
            {e.nature === "classified" && <span className="ml-1 align-middle"><ClassificationBadge /></span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children, tag }: { title: string; children: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1 flex items-center gap-2"><SectionLabel>{title}</SectionLabel>{tag}</div>
      <div className="text-xs leading-relaxed">{children}</div>
    </section>
  );
}

/** Quick depth only: the supplied readings stated as facts. No lean, entry, target or advice. */
export function EvidenceSummaryBlock({ analysis }: { analysis: Analysis }) {
  const items = evidenceSummary(analysis);
  if (!items) return null;
  return (
    <section aria-label="Evidence summary" className="rounded-lg border border-border bg-surface-2 p-3">
      <SectionLabel>Evidence summary</SectionLabel>
      <dl className="text-xs leading-relaxed">
        {items.map((it) => <div key={it.label} className="flex flex-wrap gap-x-2"><dt className="text-muted">{it.label}:</dt><dd>{it.text}</dd></div>)}
      </dl>
      <p className="mt-2 text-xs text-subtle">A restatement of the engine's supplied readings, not a prediction or advice. Switch to Standard or Deep for the full reasoning.</p>
    </section>
  );
}

/** The five questions: what, why, supporting, contradicting, what next. Used on the Overview. */
export function InterpretationSummary({ analysis, level }: { analysis: Analysis; level: DetailLevel }) {
  const i = analysis.interpretation;
  if (!i) return <StateMessage icon={FileQuestion} title="No interpretation available">The engine did not produce an interpretation for this selection.</StateMessage>;
  return (
    <div className="space-y-3">
      {i.evidenceBalance === "mixed" || i.evidenceBalance === "contradictory" ? <MixedEvidenceNotice /> : null}
      {level === "quick" && <EvidenceSummaryBlock analysis={analysis} />}
      <Block title="What is happening?" tag={<ObservationBadge />}><NarrativeText n={i.whatIsHappening} level={level} /></Block>
      {i.whyItMatters && <Block title="Why does it matter?"><NarrativeText n={i.whyItMatters} level={level} /></Block>}
      <Block title="What evidence supports it?"><EvidenceList items={i.supporting} tone="support" /></Block>
      <Block title="What contradicts it?"><EvidenceList items={i.contradicting} tone="contradict" /></Block>
      <Block title="What should I watch next?">
        <ul className="list-disc space-y-1 pl-4">{i.watchNext.map((w) => <li key={w.id}>{w.text}</li>)}</ul>
      </Block>
      <p className="text-xs text-subtle">As of {fmtDateTime(i.asOf, true)} · {i.uncertainty.length} stated limitations</p>
    </div>
  );
}

/** First sentence, without cutting decimal numbers. */
export function firstSentence(t?: string): string | undefined {
  return t?.split(/\.(?:\s|$)/)[0];
}

function scenarioName(i: Interpretation, id: string) {
  return i.scenarios.find((s) => s.id === id)?.title ?? id;
}

/** Full interpretation workspace (Screen 5). */
export function InterpretationFull({ analysis, level }: { analysis: Analysis; level: DetailLevel }) {
  const i = analysis.interpretation;
  if (!i) return <StateMessage icon={FileQuestion} title="No interpretation available">The engine did not produce an interpretation for this selection.</StateMessage>;
  const evById = new Map([...i.supporting, ...i.contradicting].map((e) => [e.id, e]));
  return (
    <div className="space-y-4">
      {(i.evidenceBalance === "mixed" || i.evidenceBalance === "contradictory") && <MixedEvidenceNotice />}
      <div className="space-y-4 xl:grid xl:grid-cols-2 xl:items-start xl:gap-8 xl:space-y-0">
      <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Market context"><NarrativeText n={i.context} level={level} /></Block>
        <Block title="Profile interpretation"><NarrativeText n={i.profile} level={level} /></Block>
        <Block title="VSA interpretation"><NarrativeText n={i.vsa} level={level} /></Block>
        <Block title="Price-action interpretation"><NarrativeText n={i.priceAction} level={level} /></Block>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Supporting evidence" tag={<ObservationBadge />}><EvidenceList items={i.supporting} tone="support" /></Block>
        <Block title="Contradictory evidence" tag={<ObservationBadge />}><EvidenceList items={i.contradicting} tone="contradict" /></Block>
      </div>

      </div>
      <div className="space-y-4">
      <Block title={i.scenarios.length > 1 ? "Alternative scenarios" : "Scenario"} tag={<HypothesisBadge />}>
        <p className="mb-2 text-muted">Scenarios are hypotheses consistent with some evidence and challenged by other evidence. They are not ranked as predictions.</p>
        <div className="grid gap-2 md:grid-cols-2">
          {i.scenarios.map((s) => (
            <article key={s.id} className="hypothesis space-y-1.5 rounded-md p-2.5">
              <h4 className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">{s.title}{s.isAlternative && <Badge tone="hypothesis">alternative</Badge>}</h4>
              <p className="text-muted">{s.description}</p>
              {level !== "quick" && (
                <>
                  <p><b>Consistent with:</b> {s.supportedBy.length ? s.supportedBy.map((id) => firstSentence(evById.get(id)?.text) ?? id).join("; ") : "—"}</p>
                  <p><b>Challenged by:</b> {s.challengedBy.length ? s.challengedBy.map((id) => firstSentence(evById.get(id)?.text) ?? id).join("; ") : "—"}</p>
                </>
              )}
              {level === "deep" && (s.confirmation?.length || s.invalidation?.length) ? (
                <div className="space-y-1">
                  {s.confirmation?.length ? <p><b>Would support:</b> {s.confirmation.join(" ")}</p> : null}
                  {s.invalidation?.length ? <p><b>Would weaken:</b> {s.invalidation.join(" ")}</p> : null}
                </div>
              ) : null}
              {level === "deep" && s.knowledgeSlugs.length > 0 && (
                <p className="flex flex-wrap gap-2">{s.knowledgeSlugs.map((k) => <Link key={k} href={`/knowledge/${k}`} className="text-accent hover:underline">{humanize(k)}</Link>)}</p>
              )}
            </article>
          ))}
        </div>
      </Block>

      <Block title="What to observe next">
        <ul className="space-y-2">
          {i.watchNext.map((w) => (
            <li key={w.id} className="rounded-md border border-border bg-surface-2 p-2">
              <p>{w.text}</p>
              <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {w.strengthens.map((s) => <Badge key={`s${s}`} tone="neutral">↑ strengthens: {scenarioName(i, s)}</Badge>)}
                {w.weakens.map((s) => <Badge key={`w${s}`} tone="neutral">↓ weakens: {scenarioName(i, s)}</Badge>)}
              </p>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Uncertainty and limitations">
        <ul className="space-y-1">
          {i.uncertainty.map((u, n) => (
            <li key={n} className={cn("flex items-start gap-2")}>{u.kind !== "other" && <Badge tone="warn">{humanize(u.kind)}</Badge>}<span>{u.text}</span></li>
          ))}
        </ul>
      </Block>
      </div>
      </div>
    </div>
  );
}
