"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorState, LoadingState, StateMessage } from "@/components/common/states";
import { Badge } from "@/components/ui/primitives";
import { useKnowledge } from "@/hooks/data";
import { toApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { categoryLabel } from "./Knowledge";

type GlossaryItem = { term: string; meaning: string; group: string; aliases?: string[] };

const CORE_TERMS: GlossaryItem[] = [
  { term: "Acceptance", meaning: "Evidence that trading is being sustained at or beyond a price area. In this engine it develops from completed closes and configurable bar counts; a single touch is not acceptance.", group: "Market structure" },
  { term: "As of / as_of", meaning: "The historical cutoff for an analysis. Only bars whose completion time is at or before this instant may contribute to the result.", group: "Data & method", aliases: ["replay", "cutoff"] },
  { term: "Auction", meaning: "The process of price moving through areas to find trading interest. The app describes observed movement and acceptance or rejection; it does not know participant intent.", group: "Market structure" },
  { term: "Balance", meaning: "A state where the available evidence does not show sustained acceptance above or below the prior value area. It is a descriptive classification, not a forecast.", group: "Market structure" },
  { term: "Bar close", meaning: "The final recorded price for a completed OHLCV bar. A bar is treated as observable only after its interval has ended.", group: "Data & method", aliases: ["close"] },
  { term: "Breakout", meaning: "Price moving beyond a previously observed range boundary. A breakout observation can be provisional and may later be invalidated.", group: "Market structure" },
  { term: "Causality / no look-ahead", meaning: "An analysis at a given time uses only information available by that time. Delayed pivots appear only after their confirmation bars complete.", group: "Data & method" },
  { term: "Composite profile", meaning: "A profile built from all bars in the selected visible range, combining sessions into one distribution.", group: "Profile terms" },
  { term: "Confluence", meaning: "Several measured readings pointing in the same direction. Scanner confluence is a rule-based count of related readings, not independent confirmation or a prediction.", group: "Data & method" },
  { term: "Developing profile", meaning: "The latest session's volume-based POC, VAH and VAL recalculated as each completed bar arrives. Earlier replay cutoffs return only the points then available.", group: "Profile terms" },
  { term: "Evidence", meaning: "A specific observed measurement or classified pattern, with its time and supporting facts. Evidence is distinct from a broader interpretation or hypothesis.", group: "Data & method" },
  { term: "Failed breakout", meaning: "Price crosses a range boundary but closes back inside the range on the same bar. This is the engine's price-action proxy and may differ from multi-bar definitions in other methods.", group: "Market structure" },
  { term: "First observable time", meaning: "The earliest completed-bar time when an observation can be known. It may be later than the bar or pivot timestamp that the observation describes.", group: "Data & method", aliases: ["first_observable_at"] },
  { term: "Hypothesis", meaning: "A possible explanation for evidence. The app keeps hypotheses separate from direct measurements and lists alternative explanations and conditions that could change the view.", group: "Data & method" },
  { term: "Immutable snapshot", meaning: "A saved analysis record that is read as originally calculated. Replaying or changing parameters creates a new calculation; it does not rewrite an old snapshot.", group: "Data & method" },
  { term: "Knowledge only", meaning: "A catalog entry that explains a concept but has no detector in the current engine. It will not be emitted as an observation.", group: "Data & method" },
  { term: "OHLCV", meaning: "Open, High, Low, Close and Volume: the five values supplied for each bar. They do not reveal the exact intrabar path or volume traded at each price.", group: "Abbreviations" },
  { term: "Prior reference", meaning: "The previous scheduled session used for comparison. Auction and value-location rules require it to be adjacent, complete and to have a usable value area.", group: "Profile terms" },
  { term: "Provisional / confirmed", meaning: "Lifecycle labels for a rule observation. Confirmation means the rule's specified price follow-through occurred; it does not prove a cause or make the pattern predictive.", group: "Data & method" },
  { term: "Rejection", meaning: "Price tests beyond a reference area and returns across its boundary under the engine's rule conditions. It describes price behavior, not who caused it.", group: "Market structure" },
  { term: "RTH", meaning: "Regular Trading Hours. This app uses the XNYS regular-session calendar for supported US-market analysis.", group: "Abbreviations" },
  { term: "ETH", meaning: "Extended Trading Hours. The app's extended analysis window is a declared 04:00–20:00 New York time convention on XNYS session dates; it does not verify a venue's actual availability.", group: "Abbreviations" },
  { term: "TPO", meaning: "Time Price Opportunity. A price bin counts once for each configured time period that overlaps it. This is estimated range occupancy, not trade-at-price data.", group: "Abbreviations" },
  { term: "VSA", meaning: "Volume Spread Analysis: interpreting volume alongside bar range (spread), close location and prior context. The detector thresholds here are local heuristics.", group: "Abbreviations" },
  { term: "XNYS", meaning: "The New York Stock Exchange calendar used by this version for session dates, holidays and early closes. It is also the app's supported exchange convention.", group: "Abbreviations" },
  { term: "Estimated volume profile", meaning: "Bar volume is divided evenly across every price bin touched by that bar. It is an approximation because OHLCV does not say how volume was distributed inside the range.", group: "Profile terms" },
  { term: "Value area", meaning: "The contiguous profile range grown outward from the point of control until it includes the configured share of activity (70% by default).", group: "Profile terms" },
];

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

export function GlossaryBrowser() {
  const { data, isPending, error, refetch } = useKnowledge();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All terms");
  const catalogItems = useMemo(() => (data ?? []).map((concept) => ({
    term: concept.name,
    meaning: `${concept.definition}${concept.detectorStatus === "knowledge_only" ? " This entry is explanatory only; the engine has no detector for it." : ""}`,
    group: "Concepts & strategies",
    aliases: [concept.slug.replaceAll("_", " "), concept.summary],
  })), [data]);

  const allItems = useMemo(() => {
    const unique = new Map<string, GlossaryItem>();
    for (const item of [...CORE_TERMS, ...catalogItems]) {
      const key = normalize(item.term);
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()].sort((a, b) => a.term.localeCompare(b.term));
  }, [catalogItems]);
  const groups = useMemo(() => ["All terms", ...new Set(allItems.map((item) => item.group))], [allItems]);
  const filtered = useMemo(() => {
    const needle = normalize(query);
    return allItems.filter((item) => (group === "All terms" || item.group === group)
      && (!needle || normalize(`${item.term} ${item.meaning} ${item.aliases?.join(" ") ?? ""}`).includes(needle)));
  }, [allItems, group, query]);

  if (isPending) return <LoadingState label="Loading glossary and strategy definitions…" />;
  if (error) return <ErrorState error={toApiError(error)} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-5">
      <section aria-label="Glossary search and filters" className="grid gap-3 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)] md:grid-cols-[minmax(15rem,1fr)_auto_auto] md:items-center">
        <label className="relative block">
          <span className="sr-only">Search terms</span>
          <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search a term, abbreviation or meaning…" className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm focus:border-accent/60 focus:outline-none" />
        </label>
        <div role="group" aria-label="Filter glossary category" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1">
          {groups.map((item) => <button key={item} type="button" aria-pressed={group === item} onClick={() => setGroup(item)} className={cn("shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", group === item ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}>{item}</button>)}
        </div>
        <Badge tone="info" className="justify-self-start md:justify-self-end">{filtered.length === allItems.length ? `${allItems.length} entries` : `${filtered.length} of ${allItems.length}`}</Badge>
      </section>

      {filtered.length === 0 ? <StateMessage icon={Search} title="No matching terms">Try another word or clear the category filter.</StateMessage> : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => <div key={item.term} className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)] transition-colors hover:border-border-strong">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <dt className="font-semibold leading-snug">{item.term}</dt>
              <Badge>{item.group === "Concepts & strategies" ? categoryLabel(data?.find((concept) => concept.name === item.term)?.category ?? "") : item.group}</Badge>
            </div>
            <dd className="mt-2 text-sm leading-relaxed text-muted">{item.meaning}</dd>
          </div>)}
        </dl>
      )}
      <p className="text-xs text-subtle">Pattern definitions describe local rules and make no trading recommendations. The concept catalog is loaded from the same versioned knowledge source used by the analysis. Definitions and detector thresholds are operational explanations, not independently validated predictive rules.</p>
    </div>
  );
}
