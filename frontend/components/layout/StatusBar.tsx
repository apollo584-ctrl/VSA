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
    <footer className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-surface px-6 py-1.5 text-xs text-subtle max-sm:px-4">
      {API_MODE === "mock" && (
        <Badge tone="warn" title="Responses come from deterministic synthetic fixtures, not the backend."><FlaskConical size={11} aria-hidden /> MOCK DATA</Badge>
      )}
      <span className="truncate max-sm:max-w-[60vw]">Source: {inst ? `${inst.source.name} (${inst.source.kind})` : "—"}</span>
      <span className="max-md:hidden">No real-time connection — all timestamps are historical, exchange time (ET)</span>
      {state.replayTime !== null && <Badge tone="info">Replay: {fmtDateTime(state.replayTime, true)}</Badge>}
      <span className="ml-auto flex items-center gap-2" aria-live="polite"><span aria-hidden className={`h-2 w-2 rounded-full ${fetching > 0 ? "animate-pulse bg-warn" : "bg-ok"}`} />{fetching > 0 ? "Updating…" : "Up to date"}</span>
    </footer>
  );
}
