"use client";

import { AnalysisBody, AnalysisGate } from "@/components/common/AnalysisGate";
import { EstimatedBadge } from "@/components/common/badges";
import { ChartSection } from "@/components/charts/ChartSection";
import { ProfileExplanation, ProfileKindTabs, ProfileStats, ValueMigrationTable } from "@/components/profiles/ProfileWorkspace";
import { ProfileVisual } from "@/components/profiles/ProfileVisual";
import { Panel, SectionLabel } from "@/components/ui/primitives";
import { AnalysisPageHeader } from "@/components/layout/InstrumentHeader";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

export default function ChartProfilePage() {
  const market = useMarket();
  const { state } = useWorkspace();
  const a = market.analysis;
  const profile = a?.status === "ok" ? (a.profiles[state.profileKind] ?? null) : null;
  return (
    <AnalysisGate market={market}>
      <div className="flex flex-col gap-5 xl:h-full xl:gap-4">
      <AnalysisPageHeader title="Chart & Profile" description="Candles with the session's estimated volume or TPO profile, value area and structural levels." market={market} />
      <div className="grid grid-cols-1 gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_26rem] xl:gap-4">
        <div className="flex min-h-[42rem] min-w-0 flex-col xl:min-h-0"><ChartSection market={market} /></div>
        <aside className="flex min-w-0 flex-col gap-5 xl:min-h-0 xl:gap-4 xl:overflow-y-auto [&>*]:shrink-0" aria-label="Market Profile workspace">
          <Panel title="Market Profile" actions={<>{profile?.estimated && <EstimatedBadge profile={profile} />}</>}>
            <div className="space-y-4">
              <ProfileKindTabs available={a?.status === "ok" ? Object.keys(a.profiles) : undefined} />
              <AnalysisBody analysis={a} error={market.error}>{() => profile ? (
                <>
                  <p className="text-xs text-subtle">{profile.label}{profile.estimated && profile.estimationMethod ? ` — ${profile.estimationMethod}` : ""}</p>
                  <ProfileStats profile={profile} />
                  <ProfileVisual profile={profile} weight={state.profileKind === "tpo" ? "tpo" : "volume"} currentPrice={a?.valueLocation?.price} />
                </>
              ) : <p className="text-xs text-subtle">The selected profile type is not available at this point (for example, there is no prior session yet).</p>}</AnalysisBody>
            </div>
          </Panel>
          {profile && <Panel title="Shape explanation" collapsible bodyClassName="max-h-[34rem] overflow-auto"><ProfileExplanation profile={profile} /></Panel>}
          {profile && (
            <Panel title="Value migration" collapsible defaultOpen={false}>
              <SectionLabel>Per-session value area</SectionLabel>
              <ValueMigrationTable profile={profile} />
            </Panel>
          )}
        </aside>
      </div>
      </div>
    </AnalysisGate>
  );
}
