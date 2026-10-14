"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { HypothesisBadge } from "@/components/common/badges";
import { ErrorState, LoadingState, StateMessage } from "@/components/common/states";
import { Badge, SectionLabel } from "@/components/ui/primitives";
import { useKnowledge } from "@/hooks/data";
import { cn } from "@/lib/utils";
import { humanize } from "@/lib/formatting";
import { toApiError } from "@/lib/api/errors";
import type { KnowledgeConcept } from "@/types";

export const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? humanize(c);

export const CATEGORY_LABELS: Record<string, string> = {
  strength: "VSA — strength-context patterns",
  weakness: "VSA — weakness-context patterns",
  neutral: "VSA — neutral measurements",
  profile: "Market Profile",
  auction: "Auction",
  data: "Data requirements",
  limitations: "Limitations",
  market_profile_shapes: "Market Profile Shapes",
  market_profile_concepts: "Market Profile Concepts",
  volume_profile: "Volume Profile",
  vsa_patterns: "VSA Patterns",
  auction_market_theory: "Auction Market Theory",
  price_action: "Price Action",
  volume_and_volatility: "Volume and Volatility",
  pattern_relationships: "Pattern Relationships",
};

const RELATION_LABELS: Record<KnowledgeConcept["related"][number]["relation"], string> = {
  often_precedes: "often precedes", may_lead_to: "may lead to", contradicts: "may contradict", contrasts_with: "contrasts with", component_of: "is part of", see_also: "see also",
};

// ---------- schematics ----------
const SHAPES: Record<string, number[]> = {
  D: [1, 2, 4, 6, 8, 9, 8, 6, 4, 2, 1],
  P: [1, 1, 1, 2, 3, 5, 7, 9, 9, 8, 5, 3],
  b: [3, 5, 8, 9, 9, 7, 5, 3, 2, 1, 1, 1],
  B: [2, 5, 8, 9, 7, 3, 1, 3, 7, 9, 8, 4, 2],
  trend: [2, 3, 3, 4, 3, 4, 3, 4, 3, 3, 2],
  multi: [3, 8, 6, 2, 7, 9, 3, 1, 5, 8, 4],
};

export function Schematic({ concept }: { concept: Pick<KnowledgeConcept, "schematic" | "name"> }) {
  const { kind, variant = "" } = concept.schematic;
  if (kind === "profile_shape" && SHAPES[variant]) {
    const rows = SHAPES[variant]!;
    return (
      <svg viewBox="0 0 160 130" className="h-32 w-40" role="img" aria-label={`Schematic of a ${concept.name}`}>
        {rows.map((w, i) => <rect key={i} x={10} y={6 + i * (118 / rows.length)} width={w * 12} height={118 / rows.length - 1.5} fill="var(--value)" opacity={0.2 + w / 14} />)}
        <text x={150} y={14} fontSize={9} fill="var(--fg-subtle)" textAnchor="end">high</text>
        <text x={150} y={126} fontSize={9} fill="var(--fg-subtle)" textAnchor="end">low</text>
      </svg>
    );
  }
  if (kind === "candle") {
    const cfg: Record<string, { hi: number; bt: number; bb: number; lo: number; up: boolean }> = {
      upthrust: { hi: 8, bt: 78, bb: 90, lo: 94, up: false }, shakeout: { hi: 30, bt: 38, bb: 60, lo: 120, up: true }, stopping: { hi: 14, bt: 60, bb: 100, lo: 118, up: false },
      climax_up: { hi: 8, bt: 20, bb: 80, lo: 100, up: true }, climax_down: { hi: 20, bt: 40, bb: 100, lo: 122, up: false }, no_demand: { hi: 52, bt: 60, bb: 78, lo: 84, up: true }, no_supply: { hi: 52, bt: 60, bb: 78, lo: 84, up: false },
    };
    const c = cfg[variant] ?? cfg.no_demand!;
    return (
      <svg viewBox="0 0 160 130" className="h-32 w-40" role="img" aria-label={`Schematic candle for ${concept.name}`}>
        <line x1={80} x2={80} y1={c.hi} y2={c.lo} stroke="var(--fg-muted)" strokeWidth={2} />
        <rect x={64} y={c.bt} width={32} height={c.bb - c.bt} fill={c.up ? "var(--up)" : "var(--down)"} opacity={0.75} />
        <text x={80} y={128} fontSize={9} textAnchor="middle" fill="var(--fg-subtle)">{c.up ? "up close" : "down close"} (direction only)</text>
      </svg>
    );
  }
  return <div className="grid h-32 w-40 place-items-center rounded border border-dashed border-border text-[11px] text-subtle">No schematic</div>;
}

// ---------- browser ----------
export function KnowledgeBrowser() {
  const { data, isPending, error, refetch } = useKnowledge();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((c) => (cat === "all" || c.category === cat) && (!needle || `${c.name} ${c.summary} ${c.definition}`.toLowerCase().includes(needle)));
  }, [data, q, cat]);
  if (isPending) return <LoadingState label="Loading knowledge library…" />;
  if (error) return <ErrorState error={toApiError(error)} onRetry={() => void refetch()} />;
  const present = [...new Set(data.map((c) => c.category))];
  const categories = [...Object.keys(CATEGORY_LABELS).filter((c) => present.includes(c)), ...present.filter((c) => !(c in CATEGORY_LABELS))];
  return (
    <div className="grid gap-3 lg:grid-cols-[14rem_1fr]">
      <aside className="space-y-3">
        <div className="relative">
          <Search size={13} aria-hidden className="absolute left-2 top-2 text-subtle" />
          <input aria-label="Search concepts" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search concepts…" className="h-8 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 text-xs" />
        </div>
        <nav aria-label="Categories">
          <ul className="space-y-0.5">
            {(["all", ...categories] as const).map((c) => (
              <li key={c}>
                <button type="button" onClick={() => setCat(c)} aria-pressed={cat === c} className={cn("flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs", cat === c ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                  {c === "all" ? "All concepts" : categoryLabel(c)}
                  <span className="num text-[10px] text-subtle">{c === "all" ? data!.length : data!.filter((x) => x.category === c).length}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div>
        {filtered.length === 0 ? <StateMessage icon={Search} title="No matching concepts">Try a different search or category.</StateMessage> : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((c) => (
              <li key={c.slug}>
                <Link href={`/knowledge/${c.slug}`} className="block h-full rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-2">
                  <span className="flex flex-wrap gap-1"><Badge>{categoryLabel(c.category)}</Badge>{c.detectorStatus === "knowledge_only" && <Badge tone="warn" title="Explained in the catalog but no detector exists; it never appears as an observation.">knowledge only</Badge>}</span>
                  <h3 className="mt-1.5 text-sm font-semibold">{c.name}</h3>
                  <p className="mt-0.5 text-xs text-muted">{c.summary}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- chain exploration ----------
/** Follows forward-looking contextual links to build an exploratory path. Not a causal chain. */
export function buildChain(start: string, concepts: KnowledgeConcept[], maxLen = 6): string[] {
  const by = new Map(concepts.map((c) => [c.slug, c]));
  const first = by.get(start);
  // Curated relationship concepts list their path explicitly, in order.
  if (first?.category === "pattern_relationships" && first.related.length >= 3) {
    return first.related.map((r) => r.slug).filter((s) => by.has(s)).slice(0, maxLen);
  }
  const path = [start];
  const seen = new Set(path);
  const follow: KnowledgeConcept["related"][number]["relation"][] = ["may_lead_to", "often_precedes", "contradicts"];
  while (path.length < maxLen) {
    const cur = by.get(path[path.length - 1]!);
    const next = cur?.related.find((r) => follow.includes(r.relation) && !seen.has(r.slug) && by.has(r.slug));
    if (!next) break;
    path.push(next.slug); seen.add(next.slug);
  }
  return path;
}

export function ConceptDetail({ slug }: { slug: string }) {
  const { data, isPending, error, refetch } = useKnowledge();
  if (isPending) return <LoadingState label="Loading concept…" />;
  if (error) return <ErrorState error={toApiError(error)} onRetry={() => void refetch()} />;
  const concept = data.find((c) => c.slug === slug);
  if (!concept) return <StateMessage icon={Search} title="Concept not found" action={<Link href="/knowledge" className="text-accent hover:underline">Back to library</Link>}>No concept with the identifier “{slug}” exists in the knowledge base.</StateMessage>;
  const by = new Map(data.map((c) => [c.slug, c]));
  const chain = buildChain(concept.slug, data);
  const incoming = data.filter((c) => c.related.some((r) => r.slug === concept.slug));
  const list = (xs: string[]) => <ul className="list-disc space-y-0.5 pl-4">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>;
  return (
    <article className="mx-auto max-w-4xl space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-subtle"><Link href="/knowledge" className="hover:text-fg">Knowledge</Link> / {categoryLabel(concept.category)}</nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{concept.name}</h1>
          <p className="mt-1 text-sm text-muted">{concept.summary}</p>
          {concept.detectorStatus && <p className="mt-2"><Badge tone={concept.detectorStatus === "implemented" ? "ok" : "warn"}>{concept.detectorStatus === "implemented" ? "Detector implemented" : "Knowledge only — no detector, never emitted as an observation"}</Badge></p>}
        </div>
        {concept.schematic.kind !== "none" && <Schematic concept={concept} />}
      </header>
      <div className="space-y-4 text-xs leading-relaxed">
        <section><SectionLabel>Definition</SectionLabel><p>{concept.definition}</p></section>
        {concept.detection.length > 0 && <section><SectionLabel>Detection characteristics</SectionLabel>{list(concept.detection)}</section>}
        {concept.marketContext && <section><SectionLabel>Market context</SectionLabel><p>{concept.marketContext}</p></section>}
        {concept.implications.length > 0 && <section><div className="mb-1 flex items-center gap-2"><SectionLabel>Possible implications</SectionLabel><HypothesisBadge /></div>{list(concept.implications)}</section>}
        {concept.doesNotProve && <section><SectionLabel>What it does not prove</SectionLabel>{list(concept.doesNotProve)}</section>}
        {concept.extraSections?.map((s) => <section key={s.title}><SectionLabel>{s.title}</SectionLabel>{list(s.items)}</section>)}
        {concept.alternatives.length > 0 && <section><SectionLabel>Alternative explanations</SectionLabel>{list(concept.alternatives)}</section>}
        {(concept.confirmation.length > 0 || concept.invalidation.length > 0) && (
          <section className="grid gap-4 sm:grid-cols-2">
            <div><SectionLabel>Confirmation</SectionLabel>{list(concept.confirmation)}</div>
            <div><SectionLabel>Invalidation</SectionLabel>{list(concept.invalidation)}</div>
          </section>
        )}
      </div>

      <section aria-labelledby="rel">
        <h2 id="rel" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Related concepts</h2>
        <p className="mb-2 text-[11px] text-subtle">Contextual relationships, not guaranteed causal chains.</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {concept.related.map((r) => (
            <li key={`${r.relation}-${r.slug}`}>
              <Link href={`/knowledge/${r.slug}`} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 hover:bg-surface-2">
                <Badge tone={r.relation === "contradicts" ? "warn" : "neutral"}>{RELATION_LABELS[r.relation]}</Badge>
                <span className="text-xs font-medium">{by.get(r.slug)?.name ?? humanize(r.slug)}</span>
              </Link>
              {r.note && <p className="mt-0.5 px-1 text-[11px] text-muted">{r.note}</p>}
            </li>
          ))}
        </ul>
        {incoming.length > 0 && <p className="mt-2 text-[11px] text-subtle">Referenced by: {incoming.map((c, i) => <span key={c.slug}>{i > 0 && ", "}<Link className="text-accent hover:underline" href={`/knowledge/${c.slug}`}>{c.name}</Link></span>)}</p>}
      </section>

      {chain.length > 1 && (
        <section aria-labelledby="chain" className="rounded-lg border border-border bg-surface p-3">
          <h2 id="chain" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Relationship path</h2>
          <p className="mb-2 text-[11px] text-subtle">One possible contextual path following “may lead to” and “contradicts” links. Any step may fail to occur.</p>
          <ol className="flex flex-wrap items-center gap-1.5">
            {chain.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight size={13} aria-label="then" className="text-subtle" />}
                <Link href={`/knowledge/${s}`} className={cn("rounded-md border px-2 py-1 text-xs hover:bg-surface-2", i === 0 ? "border-accent text-accent" : "border-border")}>{by.get(s)?.name ?? s}</Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="src"><h2 id="src" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Sources and provenance</h2>
        <ul className="list-disc pl-4 text-xs text-muted">{concept.sources.length ? concept.sources.map((s, i) => <li key={i}>{s.title}{s.note && ` — ${s.note}`}</li>) : <li>No sources recorded.</li>}</ul>
      </section>
    </article>
  );
}
