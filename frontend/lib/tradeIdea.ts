import { fmtPrice } from "@/lib/formatting";
import type { Analysis } from "@/types";

export type TradeIdea = {
  action: "long" | "short" | "stand_aside" | "insufficient";
  headline: string;
  /** Plain-language reasons, each tied to a supplied fact. */
  reasons: string[];
  /** Price at which the idea no longer holds, when there is one. */
  invalidation: string | null;
};

type Vote = { source: string; vote: -1 | 0 | 1; text: string };

const UP_STATES = new Set(["higher_price_acceptance", "rejection_below_value"]);
const DOWN_STATES = new Set(["lower_price_acceptance", "rejection_above_value"]);

/**
 * A rule-based idea built only from facts the backend supplied (price location, auction state, active VSA signals).
 * Three independent votes; an idea needs at least two in one direction and none against. Otherwise it stands aside.
 * It is a reading of the evidence, not a prediction, position size or personal advice.
 */
export function tradeIdea(a: Analysis): TradeIdea | null {
  if (a.status !== "ok") return null;
  const votes: Vote[] = [];

  const ctx = a.valueLocation?.context;
  if (ctx && ctx.state !== "unavailable") {
    const vote = ctx.state === "above_value" ? 1 : ctx.state === "below_value" ? -1 : 0;
    votes.push({ source: "location", vote, text: `Price ${fmtPrice(ctx.price)} is ${ctx.state === "inside_value" ? "inside" : ctx.state === "above_value" ? "above" : "below"} the prior session's value area ${fmtPrice(ctx.val)}–${fmtPrice(ctx.vah)}.` });
  }

  const state = a.auctionStates[a.auctionStates.length - 1];
  if (state && state.kind !== "indeterminate") {
    const vote = UP_STATES.has(state.kind) ? 1 : DOWN_STATES.has(state.kind) ? -1 : 0;
    votes.push({ source: "auction", vote, text: `Auction state is ${state.kind.replace(/_/g, " ")}.` });
  }

  const resets = a.auctionResets ?? [];
  const since = resets.length ? resets[resets.length - 1]!.at : -Infinity;
  const active = a.vsaEvents.filter((e) => (e.status === "provisional" || e.status === "confirmed") && e.barTime >= since);
  const strengths = active.filter((e) => e.direction === "strength").length;
  const weaknesses = active.filter((e) => e.direction === "weakness").length;
  if (strengths || weaknesses) {
    const vote = strengths > weaknesses ? 1 : weaknesses > strengths ? -1 : 0;
    votes.push({ source: "vsa", vote, text: `Active VSA signals this session: ${strengths} strength, ${weaknesses} weakness.` });
  }

  if (!votes.length) {
    return { action: "insufficient", headline: "No idea: not enough information", reasons: ["No usable prior value area, auction state or active VSA signal is available for this selection."], invalidation: null };
  }

  const up = votes.filter((v) => v.vote > 0).length;
  const down = votes.filter((v) => v.vote < 0).length;
  const reasons = votes.map((v) => v.text);
  const mixed = a.interpretation?.evidenceBalance === "mixed" || a.interpretation?.evidenceBalance === "contradictory";

  if (up >= 2 && down === 0 && !mixed) {
    const level = ctx?.state === "above_value" ? ctx.vah : ctx && ctx.state !== "unavailable" ? ctx.val : null;
    return { action: "long", headline: "Lean long", reasons, invalidation: level == null ? null : `Idea fails on a close below ${fmtPrice(level)}.` };
  }
  if (down >= 2 && up === 0 && !mixed) {
    const level = ctx?.state === "below_value" ? ctx.val : ctx && ctx.state !== "unavailable" ? ctx.vah : null;
    return { action: "short", headline: "Lean short", reasons, invalidation: level == null ? null : `Idea fails on a close above ${fmtPrice(level)}.` };
  }
  const why = up && down ? "The evidence points in both directions." : mixed ? "The engine reports mixed evidence." : "Fewer than two independent signals agree.";
  return { action: "stand_aside", headline: "Stand aside", reasons: [why, ...reasons], invalidation: null };
}
