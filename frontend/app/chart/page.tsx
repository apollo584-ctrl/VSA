"use client";

import { AnalysisBody, AnalysisGate } from "@/components/common/AnalysisGate";
import { EstimatedBadge } from "@/components/common/badges";
import { ChartSection } from "@/components/charts/ChartSection";
import { ProfileExplanation, ProfileKindTabs, ProfileStats, ValueMigrationTable } from "@/components/profiles/ProfileWorkspace";
import { ProfileVisual } from "@/components/profiles/ProfileVisual";
import { Panel, SectionLabel } from "@/components/ui/primitives";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

export default function ChartProfilePage() {
  const market = useMarket();
  const { state } = useWorkspace();
  const a = market.analysis;
  const profile = a?.status === "ok" ? (a.profiles[state.profileKind] ?? null) : null;
  return (
    <AnalysisGate market={market}>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-h-[38rem] min-w-0 flex-col"><ChartSection market={market} /></div>
        <aside className="flex min-w-0 flex-col gap-3" aria-label="Market Profile workspace">
          <Panel title="Market Profile" actions={<>{profile?.estimated && <EstimatedBadge profile={profile} />}</>}>
            <div className="space-y-3">
              <ProfileKindTabs available={a?.status === "ok" ? Object.keys(a.profiles) : undefined} />
              <AnalysisBody analysis={a} error={market.error}>{() => profile ? (
                <>
                  <p className="text-[11px] text-subtle">{profile.label}{profile.estimated && profile.estimationMethod ? ` — ${profile.estimationMethod}` : ""}</p>
                  <ProfileVisual profile={profile} weight={state.profileKind === "tpo" ? "tpo" : "volume"} currentPrice={a?.valueLocation?.price} />
                  <ProfileStats profile={profile} />
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
    </AnalysisGate>
  );
}
