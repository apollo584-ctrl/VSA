"use client";

import { AnalysisBody, AnalysisGate } from "@/components/common/AnalysisGate";
import { ReplayControls } from "@/components/charts/ChartControls";
import { DetailLevelSwitch, InterpretationFull } from "@/components/interpretation/InterpretationPanel";
import { Panel } from "@/components/ui/primitives";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

export default function InterpretationPage() {
  const market = useMarket();
  const { state } = useWorkspace();
  const a = market.analysis;
  return (
    <AnalysisGate market={market}>
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <ReplayControls allBars={market.allBars} />
        <Panel title="Market interpretation" actions={<DetailLevelSwitch />}>
          <AnalysisBody analysis={a}>{(an) => <InterpretationFull analysis={an} level={state.detailLevel} />}</AnalysisBody>
        </Panel>
      </div>
    </AnalysisGate>
  );
}
