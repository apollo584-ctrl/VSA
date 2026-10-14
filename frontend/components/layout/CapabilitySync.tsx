"use client";

import { useEffect } from "react";
import { useInstruments } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";

/**
 * A dataset has a fixed bar interval and session mode. When the selected dataset does not offer the current
 * timeframe/session, adopt what it does offer instead of asking the backend for something that does not exist.
 */
export function CapabilitySync() {
  const { state, set } = useWorkspace();
  const { data } = useInstruments();
  const inst = data?.find((i) => i.symbol === state.symbol);
  useEffect(() => {
    if (!inst) return;
    const patch: { timeframe?: string; session?: string } = {};
    if (!inst.timeframes.includes(state.timeframe) && inst.timeframes[0]) patch.timeframe = inst.timeframes[0];
    if (!inst.sessions.includes(state.session) && inst.sessions[0]) patch.session = inst.sessions[0];
    if (patch.timeframe || patch.session) set(patch);
  }, [inst, state.timeframe, state.session, set]);
  return null;
}
