"use client";

import { AnalysisBody, AnalysisGate, AuctionSummaryCard, KeyLevelsTable, ValueLocationCard } from "@/components/common/AnalysisGate";
import { EstimatedBadge } from "@/components/common/badges";
import { ChartSection } from "@/components/charts/ChartSection";
import { DetailLevelSwitch, InterpretationSummary } from "@/components/interpretation/InterpretationPanel";
import { MiniProfile, ProfileKindTabs } from "@/components/profiles/ProfileWorkspace";
import { Panel } from "@/components/ui/primitives";
import { VsaDetailPanel, VsaEventList } from "@/components/vsa/VsaPanels";
import { AnalysisPageHeader } from "@/components/layout/InstrumentHeader";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

export default function OverviewPage() {
  const market = useMarket();
  const { state, set } = useWorkspace();
  const a = market.analysis;
  const ok = a?.status === "ok";
  const selected = a?.vsaEvents.find((e) => e.id === state.selectedEventId) ?? null;
  const profile = ok ? (a.profiles[state.profileKind] ?? a.profiles.volume) : undefined;

  return (
    <AnalysisGate market={market}>
      <div className="flex flex-col gap-6">
      <AnalysisPageHeader title="Overview" description="Price, profile, volume behaviour and the engine's reading for the selected instrument, as of the chosen bar." market={market} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex min-h-[34rem] flex-col"><ChartSection market={market} /></div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
            <Panel title="Profile" actions={profile?.estimated ? <EstimatedBadge profile={profile} /> : undefined}>
              <AnalysisBody analysis={a} error={market.error}>{(an) => <div className="space-y-2"><ProfileKindTabs available={Object.keys(an.profiles)} /><MiniProfile analysis={an} kind={state.profileKind} /></div>}</AnalysisBody>
            </Panel>
            <Panel title="VSA observations" description="Volume behaviour detected up to this bar" className="max-h-[28rem]" bodyClassName="overflow-auto">
              {selected
                ? <VsaDetailPanel event={selected} level={state.detailLevel} onClose={() => set({ selectedEventId: null })} />
                : <VsaEventList events={a?.vsaEvents ?? []} selectedId={state.selectedEventId} onSelect={(id) => set({ selectedEventId: id })} scopeLabel="up to this point" />}
            </Panel>
            <Panel title="Structural levels" description="Reference prices from the profiles" bodyClassName="max-h-96 overflow-auto"><KeyLevelsTable levels={a?.levels ?? []} /></Panel>
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-6" aria-label="Analysis">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-1">
            <Panel title="Value location"><AnalysisBody analysis={a} error={market.error}>{(an) => <ValueLocationCard analysis={an} />}</AnalysisBody></Panel>
            <Panel title="Auction state"><AnalysisBody analysis={a} error={market.error}>{(an) => <AuctionSummaryCard analysis={an} />}</AnalysisBody></Panel>
          </div>
          <Panel title="Interpretation" actions={<DetailLevelSwitch />} bodyClassName="max-h-[44rem] overflow-auto">
            <AnalysisBody analysis={a} error={market.error}>{(an) => <InterpretationSummary analysis={an} level={state.detailLevel} />}</AnalysisBody>
          </Panel>
        </aside>
      </div>
      </div>
    </AnalysisGate>
  );
}
