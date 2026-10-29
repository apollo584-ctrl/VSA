"use client";

import { MousePointerClick } from "lucide-react";
import { AnalysisBody, AnalysisGate } from "@/components/common/AnalysisGate";
import { StateMessage } from "@/components/common/states";
import { ChartSection } from "@/components/charts/ChartSection";
import { DetailLevelSwitch } from "@/components/interpretation/InterpretationPanel";
import { Panel } from "@/components/ui/primitives";
import { VsaDetailPanel, VsaEventList } from "@/components/vsa/VsaPanels";
import { AnalysisPageHeader } from "@/components/layout/InstrumentHeader";
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
      <div className="flex flex-col gap-5 xl:h-full xl:gap-4">
      <AnalysisPageHeader title="VSA Analysis" description="Volume spread analysis: bars where volume, range and close location meet a defined rule set." market={market} />
      <div className="grid grid-cols-1 gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_26rem] xl:gap-4">
        <div className="flex min-h-[42rem] min-w-0 flex-col xl:min-h-0">
          <ChartSection market={market} hideProfile layerKeys={["candles", "volume", "vsa", "structure"]} />
        </div>
        <aside className="flex min-w-0 flex-col gap-5 xl:min-h-0 xl:gap-4" aria-label="VSA workspace">
          <Panel title="Detected events" description="Newest first, up to the current bar" className="xl:min-h-[9rem] xl:flex-1" bodyClassName="max-h-96 overflow-auto xl:max-h-none">
            <AnalysisBody analysis={a} error={market.error}>{() => <VsaEventList events={events} selectedId={state.selectedEventId} onSelect={(id) => set({ selectedEventId: id })} scopeLabel="up to this point" />}</AnalysisBody>
          </Panel>
          <Panel title="Pattern detail" actions={<DetailLevelSwitch />} className="xl:min-h-[9rem] xl:flex-1" bodyClassName="overflow-auto">
            {selected
              ? <VsaDetailPanel event={selected} level={state.detailLevel} onClose={() => set({ selectedEventId: null })} />
              : <StateMessage icon={MousePointerClick} title="Select a pattern">Click a marker on the chart or an event in the list to see its measurements, conditions and alternative explanations.</StateMessage>}
          </Panel>
          <Panel title="Reading the chart" collapsible defaultOpen={false}>
            <ul className="space-y-2 text-xs leading-relaxed text-muted">
              <li>Only potential strength and potential weakness hypotheses are marked on the chart. Neutral measurements (compression, relative volume and similar) are listed under Detected events and appear on the chart only while selected.</li>
              <li>Markers show a pattern code and its status: <b className="text-fg">?</b> provisional, <b className="text-fg">✓</b> confirmed, <b className="text-fg">×</b> invalidated, <b className="text-fg">~</b> expired.</li>
              <li>Volume expansion bars are drawn <span className="font-semibold" style={{ color: "#22e07a" }}>bright green</span> and volume contraction bars <span className="font-semibold" style={{ color: "#c0392b" }}>dark red</span> instead of carrying a label.</li>
              <li>A marker sits above or below its bar according to the engine&apos;s contextual label (potential weakness, potential strength or neutral). It is a hypothesis, not a trade instruction.</li>
            </ul>
          </Panel>
        </aside>
      </div>
      </div>
    </AnalysisGate>
  );
}
