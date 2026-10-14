"use client";

import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { QualityIndicators } from "@/components/common/badges";
import { ErrorState, LoadingState } from "@/components/common/states";
import { DetailLevelSwitch, InterpretationFull } from "@/components/interpretation/InterpretationPanel";
import { Badge, Button, KeyValue, Panel } from "@/components/ui/primitives";
import { VsaDetailPanel, VsaEventList } from "@/components/vsa/VsaPanels";
import { useWorkspace } from "@/hooks/workspace";
import { api } from "@/lib/api/client";
import { toApiError } from "@/lib/api/errors";
import { fmtDateTime } from "@/lib/formatting";

/** Reopens a persisted analysis exactly as stored (GET /analyses/{id}); nothing is recomputed. */
export default function SnapshotPage() {
  const { id } = useParams<{ id: string }>();
  const { state, selectInstrument } = useWorkspace();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["snapshot", id], queryFn: () => api.getSnapshot(id), staleTime: Infinity, retry: false });

  if (q.isPending) return <LoadingState label="Loading saved analysis…" />;
  if (q.error) return <ErrorState error={toApiError(q.error)} onRetry={() => void q.refetch()} />;
  const a = q.data;
  const ev = a.vsaEvents.find((e) => e.id === selected) ?? null;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <Panel
        title="Saved analysis snapshot"
        actions={<Badge tone="info"><Lock size={11} aria-hidden />Immutable</Badge>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <dl className="text-xs">
            <KeyValue k="Snapshot ID" v={<span className="break-all">{a.snapshot?.id}</span>} />
            <KeyValue k="Instrument" v={`${a.symbol} · ${a.timeframe}`} />
            <KeyValue k="Analysis as of (last bar start)" v={fmtDateTime(a.asOf, true)} />
            <KeyValue k="Computed at" v={a.snapshot ? new Date(a.snapshot.createdAt).toLocaleString() : "—"} />
            <KeyValue k="Engine / knowledge" v={a.snapshot ? `${a.snapshot.engineVersion} / ${a.snapshot.knowledgeVersion}` : "—"} />
            <KeyValue k="Source" v={`${a.source.name} (${a.source.kind})`} />
          </dl>
          <div className="space-y-2 text-xs text-muted">
            <p>This is the stored result. It is not recomputed when you open it, so it reflects the engine, knowledge and parameters at creation time.</p>
            <QualityIndicators quality={a.quality} asOf={a.asOf} />
            {a.snapshot && (
              <Button size="sm" onClick={() => { selectInstrument(a.snapshot!.datasetId); router.push("/chart"); }}>Open dataset in chart{state.symbol === a.snapshot.datasetId ? " (current)" : ""}</Button>
            )}
          </div>
        </div>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-[1fr_24rem]">
        <Panel title="Interpretation" actions={<DetailLevelSwitch />}><InterpretationFull analysis={a} level={state.detailLevel} /></Panel>
        <Panel title="VSA observations" bodyClassName="max-h-[48rem] overflow-auto">
          {ev ? <VsaDetailPanel event={ev} level={state.detailLevel} onClose={() => setSelected(null)} /> : <VsaEventList events={a.vsaEvents} selectedId={selected} onSelect={setSelected} scopeLabel="in this snapshot" />}
        </Panel>
      </div>
    </div>
  );
}
