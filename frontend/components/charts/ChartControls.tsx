"use client";

import { ChevronLeft, ChevronRight, ChevronsRight, History } from "lucide-react";
import { Badge, Button, Toggle } from "@/components/ui/primitives";
import { useWorkspace } from "@/hooks/workspace";
import { fmtDateTime } from "@/lib/formatting";
import type { Bar, LayerKey, Layers } from "@/types";

const LAYER_DEFS: { key: LayerKey; label: string; swatch?: string; dashed?: boolean }[] = [
  { key: "candles", label: "Candles" },
  { key: "volume", label: "Volume" },
  { key: "ma50", label: "MA 50", swatch: "var(--hvn)" },
  { key: "ma200", label: "MA 200", swatch: "var(--poc)" },
  { key: "tpo", label: "TPO", swatch: "var(--accent)" },
  { key: "volumeProfile", label: "Volume profile", swatch: "var(--value)" },
  { key: "valueLevels", label: "VAH/VAL/POC", swatch: "var(--poc)" },
  { key: "nodes", label: "HVN/LVN", swatch: "var(--hvn)", dashed: true },
  { key: "vsa", label: "VSA", swatch: "var(--vsa)" },
  { key: "structure", label: "Levels", swatch: "var(--ib)", dashed: true },
  { key: "auction", label: "Auction states", swatch: "var(--fg-muted)", dashed: true },
];

/** "Averages: Daily | Chart bars" (hidden on 1D charts, where both mean the same thing). */
export function MaBasisSwitch({ basis, onChange, fellBack }: { basis: "daily" | "bars"; onChange: (b: "daily" | "bars") => void; fellBack?: boolean }) {
  const opts: { id: "daily" | "bars"; label: string }[] = [{ id: "daily", label: "Daily" }, { id: "bars", label: "30 mins" }];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span id="ma-basis-label">Averages</span>
      <div role="group" aria-labelledby="ma-basis-label" className="flex overflow-hidden rounded-lg border border-border">
        {opts.map((o) => (
          <button
            key={o.id} type="button" aria-pressed={basis === o.id} onClick={() => onChange(o.id)}
            className={`h-7 px-2.5 font-medium ${basis === o.id ? "bg-accent-soft text-accent" : "hover:bg-surface-2 hover:text-fg"}`}
          >{o.label}</button>
        ))}
      </div>
      {fellBack && <span className="text-subtle" role="status">Daily data unavailable; showing 30-min averages.</span>}
    </div>
  );
}

export function LayerControls({ only, layers, onToggle }: { only?: LayerKey[]; layers?: Layers; onToggle?: (key: LayerKey) => void }) {
  const { state, toggleLayer } = useWorkspace();
  const current = layers ?? state.layers;
  const toggle = onToggle ?? toggleLayer;
  return (
    <div role="group" aria-label="Chart layers" className="flex flex-wrap items-center gap-2">
      {LAYER_DEFS.filter((l) => !only || only.includes(l.key)).map((l) => (
        <Toggle key={l.key} label={l.label} swatch={l.swatch} dashed={l.dashed} checked={current[l.key]} onChange={() => toggle(l.key)} />
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
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-3 py-2" role="group" aria-label="Analysis timeline">
      <span className="flex items-center gap-2 text-xs font-medium text-muted"><History size={16} aria-hidden className="text-subtle" />Replay</span>
      <Button variant="ghost" size="icon" aria-label="Previous bar" onClick={() => go(cursorIdx - 1)} disabled={cursorIdx <= 0}><ChevronLeft size={18} aria-hidden /></Button>
      <input
        type="range" min={0} max={allBars.length - 1} value={cursorIdx}
        aria-label="Replay position" aria-valuetext={fmtDateTime(bar.t, true)}
        onChange={(e) => go(Number(e.target.value))}
        className="h-1.5 min-w-40 flex-1 cursor-pointer accent-[var(--accent)]"
      />
      <Button variant="ghost" size="icon" aria-label="Next bar" onClick={() => go(cursorIdx + 1)} disabled={cursorIdx >= allBars.length - 1}><ChevronRight size={18} aria-hidden /></Button>
      <Button variant="ghost" size="sm" aria-label="Jump to latest" onClick={() => set({ replayTime: null })} disabled={state.replayTime === null}><ChevronsRight size={16} aria-hidden />Latest</Button>
      {state.replayTime !== null
        ? <Badge tone="info" title="Only information available at this bar is shown. Later confirmations are hidden.">Historical analysis · as of {fmtDateTime(bar.t, true)}</Badge>
        : <span className="num text-xs text-subtle">{fmtDateTime(bar.t, true)} · bar {cursorIdx + 1} of {allBars.length}</span>}
    </div>
  );
}
