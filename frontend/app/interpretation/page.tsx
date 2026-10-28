"use client";

import { AnalysisBody, AnalysisGate } from "@/components/common/AnalysisGate";
import { ReplayControls } from "@/components/charts/ChartControls";
import { DetailLevelSwitch, InterpretationFull } from "@/components/interpretation/InterpretationPanel";
import { Panel } from "@/components/ui/primitives";
import { AnalysisPageHeader } from "@/components/layout/InstrumentHeader";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

export default function InterpretationPage() {
  const market = useMarket();
  const { state } = useWorkspace();
  const a = market.analysis;
  return (
    <AnalysisGate market={market}>
      <div className="mx-auto flex max-w-[110rem] flex-col gap-5 xl:gap-4">
        <AnalysisPageHeader title="Interpretation" description="What the evidence supports, what contradicts it and what to watch next. Scenarios are hypotheses, not predictions." market={market} actions={<DetailLevelSwitch />} />
        {!market.dailyView && <ReplayControls allBars={market.allBars} />}
        <Panel title="Market interpretation">
          <AnalysisBody analysis={a} error={market.error}>{(an) => <InterpretationFull analysis={an} level={state.detailLevel} />}</AnalysisBody>
        </Panel>
      </div>
    </AnalysisGate>
  );
}
