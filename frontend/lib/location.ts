import { fmtPrice } from "@/lib/formatting";
import type { z } from "zod";
import type { locationContextSchema } from "@/lib/api/schemas";

export type LocationContext = z.infer<typeof locationContextSchema>;

export const LOCATION_LABEL: Record<LocationContext["state"], string> = {
  above_value: "Above prior value",
  inside_value: "Inside prior value",
  below_value: "Below prior value",
  unavailable: "Unavailable",
};

const REASONS: Record<string, string> = {
  no_prior_session: "there is no earlier session in the data",
  prior_session_not_adjacent: "the prior session in the data is not the previous scheduled session",
  prior_session_incomplete: "the prior session was incomplete",
  prior_value_area_unavailable: "the prior session has no value area",
};

export const locationReason = (reason: string | null | undefined) => (reason ? (REASONS[reason] ?? reason.replace(/_/g, " ")) : "no reason supplied");

/** One-line description of a supplied location; wording only, no classification. */
export function describeLocation(l: LocationContext): string {
  if (l.state === "unavailable") return `Unavailable: ${locationReason(l.unavailableReason)}`;
  return `${LOCATION_LABEL[l.state]} (close ${fmtPrice(l.price)} vs prior value ${fmtPrice(l.val)}–${fmtPrice(l.vah)}, session ${l.referenceSession})`;
}
