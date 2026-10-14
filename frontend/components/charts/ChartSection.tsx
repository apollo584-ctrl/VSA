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
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LayerControls only={layerKeys} />
        <QualityIndicators quality={market.barsResponse?.quality} asOf={market.asOf} />
      </div>
      <AnalysisStatusBanner analysis={analysis} error={null} />
      <div className={cn("min-h-[22rem] flex-1 rounded-lg border border-border bg-surface p-1", className)}>
        <MarketChart
          bars={market.bars} fitKey={fitKey} timeframe={state.timeframe} analysis={analysis?.status === "ok" ? analysis : null}
          layers={state.layers} profileKind={state.profileKind} selectedEventId={state.selectedEventId}
          onSelectEvent={(id) => set({ selectedEventId: id })} hideProfile={hideProfile}
        />
      </div>
      {market.analysisIsStale && <p className="text-[11px] text-subtle" role="status">Updating analysis for the selected bar…</p>}
      <ReplayControls allBars={market.allBars} />
      {analysis?.snapshot && (
        <p className="text-[11px] text-subtle" data-testid="snapshot-line">
          Saved snapshot <Link href={`/snapshot/${analysis.snapshot.id}`} className="num text-accent hover:underline">{analysis.snapshot.id.slice(0, 8)}</Link> · engine {analysis.snapshot.engineVersion} · knowledge {analysis.snapshot.knowledgeVersion} · computed {new Date(analysis.snapshot.createdAt).toLocaleString()} · immutable
        </p>
      )}
      {analysis?.analysisTimeframe && analysis.analysisTimeframe !== state.timeframe && (
        <p className="text-[11px] text-subtle">Annotations were computed on {analysis.analysisTimeframe} bars and are mapped onto {state.timeframe} bars here.</p>
      )}
    </div>
  );
}
