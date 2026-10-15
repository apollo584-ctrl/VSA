"use client";

import { useState } from "react";
import { AnalysisBody, AnalysisGate } from "@/components/common/AnalysisGate";
import { AcceptanceExplainer, SessionResets, StateFlow, StateStrip, TransitionDetail } from "@/components/auction/AuctionPanels";
import { DetailLevelSwitch } from "@/components/interpretation/InterpretationPanel";
import { Panel } from "@/components/ui/primitives";
import { ReplayControls } from "@/components/charts/ChartControls";
import { AnalysisPageHeader } from "@/components/layout/InstrumentHeader";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

export default function AuctionPage() {
  const market = useMarket();
  const { state } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const a = market.analysis;
  const states = a?.auctionStates ?? [];
  const transitions = a?.auctionTransitions ?? [];
  const tr = transitions.find((t) => t.id === selectedId) ?? null;
  const to = tr ? states.find((s) => s.id === tr.toStateId) ?? null : null;
  const from = tr?.fromStateId ? states.find((s) => s.id === tr.fromStateId) ?? null : null;
  return (
    <AnalysisGate market={market}>
      <div className="flex flex-col gap-6">
        <AnalysisPageHeader title="Auction Structure" description="How price behaved relative to the prior complete session's value area, session by session." market={market} />
        <ReplayControls allBars={market.allBars} />
        <AnalysisBody analysis={a} error={market.error}>{() => (
          <>
            <Panel title="State timeline" description="Each segment is one classified state; select one to see its transition evidence"><StateStrip states={states} selectedStateId={to?.id ?? null} onSelect={(id) => setSelectedId(transitions.find((t) => t.toStateId === id)?.id ?? null)} /></Panel>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_28rem]">
              <Panel title="Auction evolution" description="States by session, oldest first" bodyClassName="max-h-[44rem] overflow-auto"><StateFlow states={states} transitions={transitions} selectedTransitionId={selectedId} onSelect={setSelectedId} /></Panel>
              <div className="flex flex-col gap-6">
                <Panel title="Transition evidence" actions={<DetailLevelSwitch />}><TransitionDetail transition={tr} from={from} to={to} level={state.detailLevel} /></Panel>
                <Panel title="Session resets" collapsible><SessionResets resets={a?.auctionResets} /></Panel>
                <Panel title="Excursion vs. acceptance" collapsible><AcceptanceExplainer /></Panel>
              </div>
            </div>
          </>
        )}</AnalysisBody>
      </div>
    </AnalysisGate>
  );
}
