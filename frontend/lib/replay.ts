/**
 * Replay / no-look-ahead guards.
 *
 * The backend is responsible for returning only what was knowable at `asOf`. These helpers are a
 * defensive second layer in the UI: anything detected after `asOf` is dropped, and statuses that were
 * assigned after `asOf` are rolled back, so future-confirmed information is never presented as known.
 */
import type { AuctionReset, AuctionState, AuctionTransition, Bar, VsaEvent } from "@/types";

export function clipBars(bars: Bar[], asOf: number | null): Bar[] {
  if (asOf === null) return bars;
  let hi = bars.length;
  while (hi > 0 && bars[hi - 1]!.t > asOf) hi--;
  return hi === bars.length ? bars : bars.slice(0, hi);
}

export function knownEvents(events: VsaEvent[], asOf: number | null): VsaEvent[] {
  if (asOf === null) return events;
  return events
    .filter((e) => e.detectedAt <= asOf)
    .map((e) => {
      const history = e.statusHistory.filter((h) => h.at <= asOf);
      if (history.length === e.statusHistory.length) return e;
      const status = history[history.length - 1]?.status ?? "provisional";
      return { ...e, status, statusHistory: history };
    });
}

export function knownStates(states: AuctionState[], asOf: number | null): AuctionState[] {
  if (asOf === null) return states;
  return states
    .filter((s) => s.detectedAt <= asOf)
    .map((s) => (s.endTime !== null && s.endTime > asOf ? { ...s, endTime: null } : s));
}

export function knownTransitions(transitions: AuctionTransition[], asOf: number | null): AuctionTransition[] {
  if (asOf === null) return transitions;
  return transitions.filter((t) => t.detectedAt <= asOf);
}

/** A reset is known once its first bar is in view (the cursor is a bar start, as for transitions). */
export function knownResets(resets: AuctionReset[] | null | undefined, asOf: number | null): AuctionReset[] | null {
  if (!resets) return null;
  return asOf === null ? resets : resets.filter((r) => r.at <= asOf);
}

/** Map an event/state time onto the bar that contains it (for charts whose timeframe is coarser than the engine's). */
export function barTimeContaining(bars: Bar[], t: number): number | null {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? bars[ans]!.t : null;
}
