"use client";

import { useDailyBars } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";
import type { DailyBar } from "@/lib/charting/movingAverages";
import type { Instrument } from "@/types";

/** Ticker for the daily-bars request: the first token of the instrument label ("SPY · 30m"). */
export function tickerOf(instrument: Pick<Instrument, "label"> | null | undefined): string | null {
  const t = instrument?.label?.split(/\s+[·-]\s+/)[0]?.trim().toUpperCase();
  return t ? t : null;
}

/**
 * Shared by the main chart and the pop-out: the saved basis, the daily bars to draw (null = use chart bars),
 * and whether the daily request failed so the UI can say why chart bars are shown instead.
 */
export function useMaBasis(instrument: Pick<Instrument, "label"> | null | undefined) {
  const { state, set } = useWorkspace();
  const intraday = state.timeframe !== "1D";
  const wantsDaily = intraday && state.maBasis === "daily";
  const daily = useDailyBars(tickerOf(instrument), wantsDaily);
  const bars: DailyBar[] = daily.data?.bars ?? [];
  const usable = wantsDaily && bars.length > 0;
  const fellBack = wantsDaily && (daily.isError || (daily.isSuccess && bars.length === 0));
  return {
    basis: state.maBasis,
    setBasis: (maBasis: "daily" | "bars") => set({ maBasis }),
    show: intraday,
    dailyBars: usable ? bars : null,
    fellBack,
  };
}
