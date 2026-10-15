"use client";

import { useState } from "react";
import { AnalysisBody, AnalysisGate, AuctionSummaryCard, KeyLevelsTable, SignalsCard, ValueLocationCard } from "@/components/common/AnalysisGate";
import { EstimatedBadge } from "@/components/common/badges";
import { ChartSection } from "@/components/charts/ChartSection";
import { DetailLevelSwitch, InterpretationSummary } from "@/components/interpretation/InterpretationPanel";
import { MiniProfile, ProfileKindTabs } from "@/components/profiles/ProfileWorkspace";
import { Panel, Segmented } from "@/components/ui/primitives";
import { VsaDetailPanel, VsaEventList } from "@/components/vsa/VsaPanels";
import { AnalysisPageHeader } from "@/components/layout/InstrumentHeader";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

type Detail = "vsa" | "profile" | "levels";

/**
 * Ordered by importance: the current reading at a glance, then price with the engine's interpretation,
 * then the supporting detail (observations, profile, levels) at the bottom.
 */
export default function OverviewPage() {
  const market = useMarket();
  const { state, set } = useWorkspace();
  const [detail, setDetail] = useState<Detail>("vsa");
  const a = market.analysis;
  const ok = a?.status === "ok";
  const selected = a?.vsaEvents.find((e) => e.id === state.selectedEventId) ?? null;
  const profile = ok ? (a.profiles[state.profileKind] ?? a.profiles.volume) : undefined;

  return (
    <AnalysisGate market={market}>
      <div className="flex flex-col gap-5 xl:h-full xl:gap-4">
        <AnalysisPageHeader title="Overview" market={market} />

        <section aria-label="At a glance" className="grid grid-cols-1 gap-5 md:grid-cols-3 xl:shrink-0 xl:gap-4">
          <Panel title="Value location"><AnalysisBody analysis={a} error={market.error}>{(an) => <ValueLocationCard analysis={an} />}</AnalysisBody></Panel>
          <Panel title="Auction state"><AnalysisBody analysis={a} error={market.error}>{(an) => <AuctionSummaryCard analysis={an} />}</AnalysisBody></Panel>
          <Panel title="Signals this session"><AnalysisBody analysis={a} error={market.error}>{(an) => <SignalsCard analysis={an} />}</AnalysisBody></Panel>
        </section>

        <div className="grid grid-cols-1 gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_26rem] xl:grid-rows-[minmax(0,1fr)] xl:gap-4">
          <div className="flex min-h-[34rem] min-w-0 flex-col xl:min-h-0"><ChartSection market={market} /></div>
          <aside className="flex min-w-0 flex-col gap-5 xl:min-h-0 xl:gap-4" aria-label="Analysis">
            <Panel title="Interpretation" actions={<DetailLevelSwitch />} className="xl:min-h-0 xl:flex-[3]" bodyClassName="max-h-[44rem] overflow-auto xl:max-h-none">
              <AnalysisBody analysis={a} error={market.error}>{(an) => <InterpretationSummary analysis={an} level={state.detailLevel} />}</AnalysisBody>
            </Panel>
            <Panel
              title="Details"
              actions={<Segmented<Detail> label="Detail" size="sm" value={detail} onChange={setDetail} options={[{ value: "vsa", label: "VSA" }, { value: "profile", label: "Profile" }, { value: "levels", label: "Levels" }]} />}
              className="max-h-[32rem] xl:max-h-none xl:min-h-0 xl:flex-[2]" bodyClassName="overflow-auto"
            >
              {detail === "vsa" && (selected
                ? <VsaDetailPanel event={selected} level={state.detailLevel} onClose={() => set({ selectedEventId: null })} />
                : <VsaEventList events={a?.vsaEvents ?? []} selectedId={state.selectedEventId} onSelect={(id) => set({ selectedEventId: id })} scopeLabel="up to this point" />)}
              {detail === "profile" && (
                <AnalysisBody analysis={a} error={market.error}>{(an) => (
                  <div className="space-y-2">
                    {profile?.estimated && <EstimatedBadge profile={profile} />}
                    <ProfileKindTabs available={Object.keys(an.profiles)} />
                    <MiniProfile analysis={an} kind={state.profileKind} />
                  </div>
                )}</AnalysisBody>
              )}
              {detail === "levels" && <KeyLevelsTable levels={a?.levels ?? []} />}
            </Panel>
          </aside>
        </div>
      </div>
    </AnalysisGate>
  );
}
