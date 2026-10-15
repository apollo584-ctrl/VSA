import { fmtPrice, humanize } from "@/lib/formatting";
import { LOCATION_LABEL, locationReason } from "@/lib/location";
import type { Analysis } from "@/types";

export type EvidenceSummaryItem = { label: string; text: string };

/**
 * A factual restatement of what the engine supplied: price location, auction state, active VSA signals and the
 * engine's own evidence balance. It states no direction, entry, target or lean.
 */
export function evidenceSummary(a: Analysis): EvidenceSummaryItem[] | null {
  if (a.status !== "ok") return null;
  const items: EvidenceSummaryItem[] = [];

  const ctx = a.valueLocation?.context;
  if (ctx) {
    items.push({
      label: "Price location",
      text: ctx.state === "unavailable"
        ? `Unavailable: ${locationReason(ctx.unavailableReason)}.`
        : `${LOCATION_LABEL[ctx.state]}: close ${fmtPrice(ctx.price)} against prior value ${fmtPrice(ctx.val)}–${fmtPrice(ctx.vah)} (session ${ctx.referenceSession}).`,
    });
  }

  const state = a.auctionStates[a.auctionStates.length - 1];
  if (state) items.push({ label: "Auction state", text: humanize(state.kind) });

  const resets = a.auctionResets ?? [];
  const since = resets.length ? resets[resets.length - 1]!.at : -Infinity;
  const active = a.vsaEvents.filter((e) => (e.status === "provisional" || e.status === "confirmed") && e.barTime >= since);
  const strengths = active.filter((e) => e.direction === "strength").length;
  const weaknesses = active.filter((e) => e.direction === "weakness").length;
  items.push({ label: "Active VSA signals", text: `${strengths} strength, ${weaknesses} weakness this session` });

  if (a.interpretation) items.push({ label: "Evidence balance", text: humanize(a.interpretation.evidenceBalance) });
  return items;
}
