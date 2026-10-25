"use client";

import { AnalysisStatusBanner, type Market } from "@/components/common/AnalysisGate";
import { QualityIndicators } from "@/components/common/badges";
import { useWorkspace } from "@/hooks/workspace";
import { cn } from "@/lib/utils";
import type { LayerKey, Layers } from "@/types";
import Link from "next/link";
import { useState } from "react";
import { useMaBasis } from "@/hooks/maBasis";
import { LayerControls, MaBasisSwitch, ReplayControls } from "./ChartControls";
import { MarketChart } from "./MarketChart";

const ALL_LAYER_KEYS: LayerKey[] = ["candles", "volume", "ma50", "ma200", "tpo", "volumeProfile", "valueLevels", "nodes", "vsa", "structure", "auction"];

/** Chart + layer toggles + replay timeline, wired to the shared workspace selection. */
export function ChartSection({ market, className, hideProfile, layerKeys }: { market: Market; className?: string; hideProfile?: boolean; layerKeys?: LayerKey[] }) {
  const { state, set } = useWorkspace();
  const { analysis } = market;
  const ma = useMaBasis(market.instrument);
  const fitKey = `${state.symbol}|${state.timeframe}|${state.session}|${state.date ?? "latest"}`;
  // A page that names its own layers (VSA Analysis) keeps them locally: those on, everything else off, shared prefs untouched.
  const [localLayers, setLocalLayers] = useState<Layers | null>(() =>
    layerKeys ? (Object.fromEntries(ALL_LAYER_KEYS.map((k) => [k, layerKeys.includes(k)])) as Layers) : null);
  const layers = localLayers ?? state.layers;
  const onToggle = localLayers ? (key: LayerKey) => setLocalLayers((l) => ({ ...l!, [key]: !l![key] })) : undefined;
  return (
    <section aria-label="Price chart" className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow)]">
      <LayerControls only={layerKeys} layers={localLayers ?? undefined} onToggle={onToggle} />
      {!hideProfile && ma.show && <MaBasisSwitch basis={ma.basis} onChange={ma.setBasis} fellBack={ma.fellBack} />}
      <AnalysisStatusBanner analysis={analysis} error={market.error} />
      <div className={cn("flex min-h-[44rem] flex-1 flex-col sm:min-h-[34rem]", className)}>
        <MarketChart
          bars={market.bars} fitKey={fitKey} timeframe={state.timeframe} analysis={analysis?.status === "ok" ? analysis : null}
          layers={layers} onLayersChange={localLayers ? setLocalLayers : undefined} profileKind={state.profileKind} selectedEventId={state.selectedEventId}
          onSelectEvent={(id) => set({ selectedEventId: id })} hideProfile={hideProfile} allBars={market.allBars} dailyBars={ma.dailyBars}
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
