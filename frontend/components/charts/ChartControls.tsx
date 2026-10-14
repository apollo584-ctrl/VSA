"use client";

import { ChevronLeft, ChevronRight, ChevronsRight, History } from "lucide-react";
import { Badge, Button, Toggle } from "@/components/ui/primitives";
import { useWorkspace } from "@/hooks/workspace";
import { fmtDateTime } from "@/lib/formatting";
import type { Bar, LayerKey } from "@/types";

const LAYER_DEFS: { key: LayerKey; label: string; swatch?: string; dashed?: boolean }[] = [
  { key: "candles", label: "Candles" },
  { key: "volume", label: "Volume" },
  { key: "tpo", label: "TPO", swatch: "var(--accent)" },
  { key: "volumeProfile", label: "Volume profile", swatch: "var(--value)" },
  { key: "valueLevels", label: "VAH/VAL/POC", swatch: "var(--poc)" },
  { key: "nodes", label: "HVN/LVN", swatch: "var(--hvn)", dashed: true },
  { key: "vsa", label: "VSA", swatch: "var(--vsa)" },
  { key: "structure", label: "Levels", swatch: "var(--ib)", dashed: true },
  { key: "auction", label: "Auction states", swatch: "var(--fg-muted)", dashed: true },
];

export function LayerControls({ only }: { only?: LayerKey[] }) {
  const { state, toggleLayer } = useWorkspace();
  return (
    <div role="group" aria-label="Chart layers" className="flex flex-wrap items-center gap-1">
      {LAYER_DEFS.filter((l) => !only || only.includes(l.key)).map((l) => (
        <Toggle key={l.key} label={l.label} swatch={l.swatch} dashed={l.dashed} checked={state.layers[l.key]} onChange={() => toggleLayer(l.key)} />
      ))}
    </div>
  );
}

/**
 * Analysis timeline: step through history and see only what the engine could have known at that bar.
 */
export function ReplayControls({ allBars }: { allBars: Bar[] }) {
  const { state, set } = useWorkspace();
  if (!allBars.length) return null;
  const cursorIdx = state.replayTime === null ? allBars.length - 1 : Math.max(0, allBars.findLastIndex((b) => b.t <= state.replayTime!));
  const go = (i: number) => {
    const idx = Math.min(allBars.length - 1, Math.max(0, i));
    set({ replayTime: idx === allBars.length - 1 ? null : allBars[idx]!.t });
  };
  const bar = allBars[cursorIdx]!;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5" role="group" aria-label="Analysis timeline">
      <History size={14} aria-hidden className="text-subtle" />
      <Button variant="ghost" size="icon" aria-label="Previous bar" onClick={() => go(cursorIdx - 1)} disabled={cursorIdx <= 0}><ChevronLeft size={15} aria-hidden /></Button>
      <input
        type="range" min={0} max={allBars.length - 1} value={cursorIdx}
        aria-label="Replay position" aria-valuetext={fmtDateTime(bar.t, true)}
        onChange={(e) => go(Number(e.target.value))}
        className="h-1 min-w-32 flex-1 accent-[var(--accent)]"
      />
      <Button variant="ghost" size="icon" aria-label="Next bar" onClick={() => go(cursorIdx + 1)} disabled={cursorIdx >= allBars.length - 1}><ChevronRight size={15} aria-hidden /></Button>
      <Button variant="ghost" size="sm" aria-label="Jump to latest" onClick={() => set({ replayTime: null })} disabled={state.replayTime === null}><ChevronsRight size={14} aria-hidden />Latest</Button>
      {state.replayTime !== null
        ? <Badge tone="info" title="Only information available at this bar is shown. Later confirmations are hidden.">Historical analysis · as of {fmtDateTime(bar.t, true)}</Badge>
        : <span className="text-[11px] text-subtle num">{fmtDateTime(bar.t, true)} · bar {cursorIdx + 1}/{allBars.length}</span>}
    </div>
  );
}
