"use client";

import { AnalysisStatusBanner, type Market } from "@/components/common/AnalysisGate";
import { QualityIndicators } from "@/components/common/badges";
import { useWorkspace } from "@/hooks/workspace";
import { cn } from "@/lib/utils";
import type { LayerKey } from "@/types";
import Link from "next/link";
import { LayerControls, ReplayControls } from "./ChartControls";
import { MarketChart } from "./MarketChart";

/** Chart + layer toggles + replay timeline, wired to the shared workspace selection. */
export function ChartSection({ market, className, hideProfile, layerKeys }: { market: Market; className?: string; hideProfile?: boolean; layerKeys?: LayerKey[] }) {
  const { state, set } = useWorkspace();
  const { analysis } = market;
  const fitKey = `${state.symbol}|${state.timeframe}|${state.session}|${state.date ?? "latest"}`;
  return (
    <section aria-label="Price chart" className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow)]">
      <LayerControls only={layerKeys} />
      <AnalysisStatusBanner analysis={analysis} error={market.error} />
      <div className={cn("min-h-[34rem] flex-1", className)}>
        <MarketChart
          bars={market.bars} fitKey={fitKey} timeframe={state.timeframe} analysis={analysis?.status === "ok" ? analysis : null}
          layers={state.layers} profileKind={state.profileKind} selectedEventId={state.selectedEventId}
          onSelectEvent={(id) => set({ selectedEventId: id })} hideProfile={hideProfile}
        />
      </div>
      {market.analysisIsStale && <p className="text-xs text-subtle" role="status">Updating analysis for the selected bar…</p>}
      <ReplayControls allBars={market.allBars} />
      {/* Provenance is the least important line on the card, so it shares the footer row with data quality. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <QualityIndicators quality={market.barsResponse?.quality} asOf={market.asOf} />
        {analysis?.persisted === false && <p className="text-xs text-subtle" role="status">Preview — not saved.</p>}
        {analysis?.snapshot && (
          <p className="text-xs leading-relaxed text-subtle" data-testid="snapshot-line" title={`engine ${analysis.snapshot.engineVersion} · knowledge ${analysis.snapshot.knowledgeVersion} · computed ${new Date(analysis.snapshot.createdAt).toLocaleString()} · immutable`}>
            Snapshot <Link href={`/snapshot/${analysis.snapshot.id}`} className="num text-accent hover:underline">{analysis.snapshot.id.slice(0, 8)}</Link>
          </p>
        )}
      </div>
      {analysis?.analysisTimeframe && analysis.analysisTimeframe !== state.timeframe && (
        <p className="text-xs text-subtle">Annotations were computed on {analysis.analysisTimeframe} bars and are mapped onto {state.timeframe} bars here.</p>
      )}
    </section>
  );
}
