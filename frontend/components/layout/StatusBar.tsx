"use client";

import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { useInstruments } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";
import { API_MODE } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/formatting";
import { useIsFetching } from "@tanstack/react-query";

/** Persistent footer: data provenance, freshness and the explicit absence of a real-time feed. */
export function StatusBar() {
  const { state } = useWorkspace();
  const { data } = useInstruments();
  const inst = data?.find((i) => i.symbol === state.symbol);
  const fetching = useIsFetching();
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface px-3 py-1 text-[11px] text-subtle">
      {API_MODE === "mock" && (
        <Badge tone="warn" title="Responses come from deterministic synthetic fixtures, not the backend."><FlaskConical size={11} aria-hidden /> MOCK DATA</Badge>
      )}
      <span>Source: {inst ? `${inst.source.name} (${inst.source.kind})` : "—"}</span>
      <span>No real-time connection — all timestamps are historical, exchange time (ET)</span>
      {state.replayTime !== null && <Badge tone="info">Replay: {fmtDateTime(state.replayTime, true)}</Badge>}
      <span className="ml-auto" aria-live="polite">{fetching > 0 ? "Updating…" : "Up to date"}</span>
    </footer>
  );
}
