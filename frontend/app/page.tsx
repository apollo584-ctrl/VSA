"use client";

import { AnalysisBody, AnalysisGate, AuctionSummaryCard, KeyLevelsTable, ValueLocationCard } from "@/components/common/AnalysisGate";
import { EstimatedBadge } from "@/components/common/badges";
import { ChartSection } from "@/components/charts/ChartSection";
import { DetailLevelSwitch, InterpretationSummary } from "@/components/interpretation/InterpretationPanel";
import { MiniProfile, ProfileKindTabs } from "@/components/profiles/ProfileWorkspace";
import { Panel } from "@/components/ui/primitives";
import { VsaDetailPanel, VsaEventList } from "@/components/vsa/VsaPanels";
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
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-h-[30rem] flex-col"><ChartSection market={market} /></div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            <Panel title="Profile" actions={profile?.estimated ? <EstimatedBadge profile={profile} /> : undefined}>
              <AnalysisBody analysis={a} error={market.error}>{(an) => <div className="space-y-2"><ProfileKindTabs available={Object.keys(an.profiles)} /><MiniProfile analysis={an} kind={state.profileKind} /></div>}</AnalysisBody>
            </Panel>
            <Panel title="VSA observations" className="max-h-96" bodyClassName="overflow-auto">
              {selected
                ? <VsaDetailPanel event={selected} level={state.detailLevel} onClose={() => set({ selectedEventId: null })} />
                : <VsaEventList events={a?.vsaEvents ?? []} selectedId={state.selectedEventId} onSelect={(id) => set({ selectedEventId: id })} scopeLabel="up to this point" />}
            </Panel>
            <Panel title="Structural levels" bodyClassName="max-h-80 overflow-auto"><KeyLevelsTable levels={a?.levels ?? []} /></Panel>
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-3" aria-label="Analysis">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Panel title="Value location"><AnalysisBody analysis={a} error={market.error}>{(an) => <ValueLocationCard analysis={an} />}</AnalysisBody></Panel>
            <Panel title="Auction state"><AnalysisBody analysis={a} error={market.error}>{(an) => <AuctionSummaryCard analysis={an} />}</AnalysisBody></Panel>
          </div>
          <Panel title="Interpretation" actions={<DetailLevelSwitch />} bodyClassName="max-h-[44rem] overflow-auto">
            <AnalysisBody analysis={a} error={market.error}>{(an) => <InterpretationSummary analysis={an} level={state.detailLevel} />}</AnalysisBody>
          </Panel>
        </aside>
      </div>
    </AnalysisGate>
  );
}
