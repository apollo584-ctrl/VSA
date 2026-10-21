"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MaBasisSwitch } from "@/components/charts/ChartControls";
import { MarketChart } from "@/components/charts/MarketChart";
import { useMarket } from "@/hooks/data";
import { useMaBasis } from "@/hooks/maBasis";
import { AVERAGES_LAYERS, VSA_PROFILE_LAYERS, useWorkspace } from "@/hooks/workspace";
import { cn } from "@/lib/utils";

type Mode = "averages" | "vsa";
const MODES: { id: Mode; label: string }[] = [
  { id: "averages", label: "Averages" },
  { id: "vsa", label: "VSA + profile" },
];

/** Chart-only window (no app shell). It reads the same saved symbol, timeframe and session as the main window. */
export default function ChartPopoutPage() {
  const market = useMarket();
  const { state, set } = useWorkspace();
  const ma = useMaBasis(market.instrument);
  const [mode, setMode] = useState<Mode>("averages");
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const layers = mode === "averages" ? AVERAGES_LAYERS : VSA_PROFILE_LAYERS;
  const analysis = market.analysis?.status === "ok" ? market.analysis : null;
  const fitKey = `${state.symbol}|${state.timeframe}|${state.session}|${state.date ?? "latest"}`;
  const label = market.instrument?.label ?? state.symbol ?? "No symbol";

  return (
    <div ref={rootRef} className="flex h-dvh w-screen flex-col bg-surface text-fg">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-1.5">
        <h1 className="text-sm font-semibold">{label} <span className="num font-normal text-muted">{state.timeframe}</span></h1>
        <div role="group" aria-label="Chart mode" className="flex overflow-hidden rounded-lg border border-border text-xs">
          {MODES.map((m) => (
            <button
              key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}
              className={cn("h-8 px-3 font-medium", mode === m.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}
            >{m.label}</button>
          ))}
        </div>
        {mode === "averages" && ma.show && <MaBasisSwitch basis={ma.basis} onChange={ma.setBasis} fellBack={ma.fellBack} />}
        <button
          type="button" onClick={toggleFullscreen} aria-pressed={fullscreen} title={fullscreen ? "Exit full screen" : "Full screen"}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          {fullscreen ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
        </button>
      </header>
      <div className="min-h-0 flex-1 p-1">
        <MarketChart
          bars={market.bars} allBars={market.allBars} fitKey={fitKey} timeframe={state.timeframe} analysis={analysis}
          layers={layers} profileKind={state.profileKind} selectedEventId={state.selectedEventId}
          onSelectEvent={(id) => set({ selectedEventId: id })} hidePopout dailyBars={ma.dailyBars}
        />
      </div>
    </div>
  );
}
