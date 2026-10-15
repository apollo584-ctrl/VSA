"use client";

import Link from "next/link";
import { EstimatedBadge } from "@/components/common/badges";
import { Badge, GLOSSARY, KeyValue, Panel, SectionLabel, Segmented, Term } from "@/components/ui/primitives";
import { useKnowledge } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";
import { fmtDate, fmtPrice, humanize } from "@/lib/formatting";
import type { Analysis, Profile, ProfileKind } from "@/types";
import { PROFILE_KINDS, ProfileVisual } from "./ProfileVisual";

export function ProfileKindTabs({ available }: { available?: string[] }) {
  const { state, set } = useWorkspace();
  return (
    <Segmented<ProfileKind>
      label="Profile type" value={state.profileKind} onChange={(v) => set({ profileKind: v })}
      options={PROFILE_KINDS.map((k) => ({ value: k.value, label: k.label, disabled: !!available && !available.includes(k.value), title: available && !available.includes(k.value) ? `${k.label}: not provided by the engine for this selection` : k.hint }))}
    />
  );
}

const shapeName = (t: string) => SHAPE_NAMES[t] ?? t.replace(/_/g, " ");
const SHAPE_NAMES: Record<string, string> = { D: "D-shaped", P: "P-shaped", b: "b-shaped", B: "B-shaped (double distribution)", trend: "Trend / elongated", multi: "Multi-distribution", undetermined: "Undetermined" };

/** Explains the selected profile's shape: definition, formation, suggestions, limits, alternatives, clarifying evidence. */
export function ProfileExplanation({ profile }: { profile: Profile }) {
  const { data: concepts } = useKnowledge();
  const slug = profile.shape.knowledgeSlug;
  const concept = concepts?.find((c) => c.slug === slug);
  return (
    <div className="space-y-3 text-xs leading-relaxed">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{shapeName(profile.shape.type)} profile</h3>
        {profile.shape.ambiguity && <Badge tone="warn" title="The backend's own ambiguity flag for this heuristic classification.">{profile.shape.ambiguity} ambiguity</Badge>}
        {profile.shape.confidence != null && <Badge tone="neutral" title="How strongly the backend's classification criteria were met — not a probability of any outcome.">classification confidence {Math.round(profile.shape.confidence * 100)}%</Badge>}
      </div>
      <ul className="list-disc space-y-0.5 pl-4 text-muted">{profile.shape.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
      {profile.shape.alternatives && profile.shape.alternatives.length > 0 && <p><b>Alternative classification(s):</b> {profile.shape.alternatives.map(humanize).join(", ")}</p>}
      {!concept && profile.shape.type !== "undetermined" && <p className="text-subtle">Detailed explanation unavailable (knowledge entry not loaded).</p>}
      {concept && (
        <>
          <div><SectionLabel>Definition</SectionLabel><p>{concept.definition}</p></div>
          {concept.marketContext && <div><SectionLabel>Typical auction context</SectionLabel><p>{concept.marketContext}</p></div>}
          <div><SectionLabel>What it commonly suggests</SectionLabel><ul className="list-disc pl-4">{concept.implications.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          {concept.doesNotProve && <div><SectionLabel>What it does not prove</SectionLabel><ul className="list-disc pl-4 text-muted">{concept.doesNotProve.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          <div><SectionLabel>Alternative interpretations</SectionLabel><ul className="list-disc pl-4 text-muted">{concept.alternatives.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div><SectionLabel>Evidence that would clarify</SectionLabel><ul className="list-disc pl-4"><li><b>Strengthens:</b> {concept.confirmation.join(" ")}</li><li><b>Weakens:</b> {concept.invalidation.join(" ")}</li></ul></div>
          {(profile.shape.limitations?.length || profile.limitations?.length) ? <div><SectionLabel>Limitations reported by the engine</SectionLabel><ul className="list-disc pl-4 text-muted">{[...(profile.shape.limitations ?? []), ...(profile.limitations ?? [])].map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null}
          <Link href={`/knowledge/${concept.slug}`} className="text-accent hover:underline">Open in Knowledge Explorer →</Link>
        </>
      )}
    </div>
  );
}

export function ProfileStats({ profile }: { profile: Profile }) {
  return (
    <dl className="text-xs">
      <KeyValue k={<Term hint={GLOSSARY.POC}>POC</Term>} v={fmtPrice(profile.poc)} />
      <KeyValue k={<Term hint={GLOSSARY.VAH}>VAH</Term>} v={fmtPrice(profile.vah)} />
      <KeyValue k={<Term hint={GLOSSARY.VAL}>VAL</Term>} v={fmtPrice(profile.val)} />
      <KeyValue k="Range" v={`${fmtPrice(profile.sessionLow)} – ${fmtPrice(profile.sessionHigh)}`} />
      {profile.initialBalance && <KeyValue k={<Term hint={GLOSSARY.IB}>Initial balance</Term>} v={`${fmtPrice(profile.initialBalance.low)} – ${fmtPrice(profile.initialBalance.high)}`} />}
      <KeyValue k={<Term hint={GLOSSARY.HVN}>HVNs</Term>} v={profile.hvns.length ? profile.hvns.map((p) => fmtPrice(p)).join(", ") : "none"} />
      <KeyValue k={<Term hint={GLOSSARY.LVN}>LVNs</Term>} v={profile.lvns.length ? profile.lvns.map((p) => fmtPrice(p)).join(", ") : "none"} />
      <KeyValue k="Bin size" v={fmtPrice(profile.binSize, 3)} />
      {profile.singlePrints && profile.singlePrints.length > 0 && <KeyValue k="Single prints (est.)" v={profile.singlePrints.map((p) => fmtPrice(p)).join(", ")} />}
    </dl>
  );
}

export function ValueMigrationTable({ profile }: { profile: Profile }) {
  if (profile.valueMigration.length < 2) return <p className="text-xs text-subtle">Not enough sessions to show value migration.</p>;
  const rows = profile.valueMigration;
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Value migration by session</caption>
      <thead><tr className="text-left text-subtle"><th className="py-1 font-medium">Session</th><th className="font-medium">VAL</th><th className="font-medium">POC</th><th className="font-medium">VAH</th><th className="font-medium">POC Δ</th></tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const d = i ? r.poc - rows[i - 1]!.poc : null;
          return (
            <tr key={r.date} className="border-t border-border num">
              <td className="py-1 font-sans text-muted">{r.date.slice(5)}</td><td>{fmtPrice(r.val)}</td><td className="text-poc">{fmtPrice(r.poc)}</td><td>{fmtPrice(r.vah)}</td>
              <td>{d === null ? "—" : `${d > 0 ? "▲" : d < 0 ? "▼" : "■"} ${Math.abs(d).toFixed(2)}`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Compact profile card used on the Overview. */
export function MiniProfile({ analysis, kind }: { analysis: Analysis; kind: ProfileKind }) {
  const profile = analysis.profiles[kind] ?? analysis.profiles.volume;
  if (!profile) return <p className="text-xs text-subtle">No profile available.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{shapeName(profile.shape.type)}</Badge>
        {profile.estimated && <EstimatedBadge profile={profile} />}
        <span className="text-xs text-subtle">{profile.label} · {fmtDate(profile.endTime)}</span>
      </div>
      <ProfileVisual profile={profile} weight={kind === "tpo" ? "tpo" : "volume"} currentPrice={analysis.valueLocation?.price} compact />
    </div>
  );
}

export { Panel };
