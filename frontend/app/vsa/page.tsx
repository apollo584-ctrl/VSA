"use client";

import { MousePointerClick } from "lucide-react";
import { AnalysisBody, AnalysisGate } from "@/components/common/AnalysisGate";
import { StateMessage } from "@/components/common/states";
import { ChartSection } from "@/components/charts/ChartSection";
import { DetailLevelSwitch } from "@/components/interpretation/InterpretationPanel";
import { Panel } from "@/components/ui/primitives";
import { VsaDetailPanel, VsaEventList } from "@/components/vsa/VsaPanels";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

export default function VsaPage() {
  const market = useMarket();
  const { state, set } = useWorkspace();
  const a = market.analysis;
  const events = a?.vsaEvents ?? [];
  const selected = events.find((e) => e.id === state.selectedEventId) ?? null;
  return (
    <AnalysisGate market={market}>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-h-[38rem] min-w-0 flex-col">
          <ChartSection market={market} hideProfile layerKeys={["candles", "volume", "vsa", "structure"]} />
        </div>
        <aside className="flex min-w-0 flex-col gap-3" aria-label="VSA workspace">
          <Panel title="Detected events" bodyClassName="max-h-72 overflow-auto">
            <AnalysisBody analysis={a} error={market.error}>{() => <VsaEventList events={events} selectedId={state.selectedEventId} onSelect={(id) => set({ selectedEventId: id })} scopeLabel="up to this point" />}</AnalysisBody>
          </Panel>
          <Panel title="Pattern detail" actions={<DetailLevelSwitch />} bodyClassName="overflow-auto">
            {selected
              ? <VsaDetailPanel event={selected} level={state.detailLevel} onClose={() => set({ selectedEventId: null })} />
              : <StateMessage icon={MousePointerClick} title="Select a pattern">Click a marker on the chart or an event in the list to see its measurements, conditions and alternative explanations.</StateMessage>}
          </Panel>
          <p className="px-1 text-[11px] text-subtle">Markers: code + status — <b>?</b> provisional, <b>✓</b> confirmed, <b>×</b> invalidated. Placement above or below a bar follows the engine's contextual label (weakness, strength or neutral); it is not a trade instruction.</p>
        </aside>
      </div>
    </AnalysisGate>
  );
}
