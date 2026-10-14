"use client";

import { useEffect } from "react";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";
import { pushHistory } from "@/lib/history";

/** Records the analysis the user is looking at (settled, non-replay views only) into local history. */
export function HistoryRecorder() {
  const { state } = useWorkspace();
  const market = useMarket();
  const a = market.analysis;
  const settled = a && a.status === "ok" && !market.isFetchingAnalysis && state.replayTime === null;
  useEffect(() => {
    if (!settled || !a || !state.symbol) return;
    pushHistory({ symbol: a.symbol, timeframe: a.timeframe, session: a.session, date: state.date, asOf: a.asOf, headline: a.interpretation?.whatIsHappening.quick ?? "No interpretation" });
  }, [settled, a, state.symbol, state.date]);
  return null;
}
