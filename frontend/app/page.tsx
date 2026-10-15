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
      <div className="flex flex-col gap-5 xl:h-full xl:gap-4">
      <AnalysisPageHeader title="Overview" description="Price, profile, volume behaviour and the engine's reading for the selected instrument, as of the chosen bar." market={market} />
      <div className="grid grid-cols-1 gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_25rem] xl:gap-4">
        <div className="flex min-w-0 flex-col gap-5 xl:min-h-0 xl:gap-4">
          <div className="flex min-h-[34rem] flex-col xl:min-h-[14rem] xl:flex-[3]"><ChartSection market={market} /></div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:min-h-[11rem] xl:flex-[2] xl:grid-cols-3 xl:gap-4">
            <Panel title="Profile" actions={profile?.estimated ? <EstimatedBadge profile={profile} /> : undefined}>
              <AnalysisBody analysis={a} error={market.error}>{(an) => <div className="space-y-2"><ProfileKindTabs available={Object.keys(an.profiles)} /><MiniProfile analysis={an} kind={state.profileKind} /></div>}</AnalysisBody>
            </Panel>
            <Panel title="VSA observations" description="Volume behaviour detected up to this bar" className="max-h-[28rem] xl:max-h-none" bodyClassName="overflow-auto">
              {selected
                ? <VsaDetailPanel event={selected} level={state.detailLevel} onClose={() => set({ selectedEventId: null })} />
                : <VsaEventList events={a?.vsaEvents ?? []} selectedId={state.selectedEventId} onSelect={(id) => set({ selectedEventId: id })} scopeLabel="up to this point" />}
            </Panel>
            <Panel title="Structural levels" description="Reference prices from the profiles" className="xl:max-h-none" bodyClassName="max-h-96 overflow-auto xl:max-h-none"><KeyLevelsTable levels={a?.levels ?? []} /></Panel>
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-5 xl:min-h-0 xl:gap-4 xl:overflow-y-auto" aria-label="Analysis">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-1 xl:gap-4">
            <Panel title="Value location"><AnalysisBody analysis={a} error={market.error}>{(an) => <ValueLocationCard analysis={an} />}</AnalysisBody></Panel>
            <Panel title="Auction state"><AnalysisBody analysis={a} error={market.error}>{(an) => <AuctionSummaryCard analysis={an} />}</AnalysisBody></Panel>
          </div>
          <Panel title="Interpretation" actions={<DetailLevelSwitch />} className="xl:min-h-[10rem] xl:flex-1" bodyClassName="max-h-[44rem] overflow-auto xl:max-h-none">
            <AnalysisBody analysis={a} error={market.error}>{(an) => <InterpretationSummary analysis={an} level={state.detailLevel} />}</AnalysisBody>
          </Panel>
        </aside>
      </div>
      </div>
    </AnalysisGate>
  );
}
