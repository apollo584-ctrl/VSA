"use client";

import { useEffect, useRef } from "react";
import { API_MODE, api } from "@/lib/api/client";
import { useInstruments, useLoadSymbol } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

const DEFAULT_SYMBOL = "SPY";

/** Starts the terminal on SPY when no symbol is remembered, so the first screen is never empty. Runs once. */
export function DefaultSymbol() {
  const { state, ready, selectInstrument } = useWorkspace();
  const instruments = useInstruments();
  const load = useLoadSymbol();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !ready || API_MODE !== "http" || instruments.data === undefined) return;
    done.current = true;
    if (state.symbol) {
      // A remembered older copy of a stock moves to its newest dataset.
      const remembered = state.symbol;
      if (!instruments.data.some((i) => i.symbol === remembered)) {
        api.resolveDataset(remembered).then((id) => { if (id !== remembered) selectInstrument(id); }).catch(() => {});
      }
      return;
    }
    // An instrument's symbol is its dataset id; the ticker is the first part of its label ("SPY - 30m").
    const spy = instruments.data.find((i) => i.label?.startsWith(`${DEFAULT_SYMBOL} \u00b7 `) && !i.label.endsWith("demo"));
    if (spy) { selectInstrument(spy.symbol); return; }
    // Not downloaded yet: fetch it. A failure leaves the normal empty screen and the search box.
    load.mutate(DEFAULT_SYMBOL, { onSuccess: ({ datasetId }) => selectInstrument(datasetId) });
  }, [ready, instruments.data, state.symbol, selectInstrument, load]);

  return null;
}
