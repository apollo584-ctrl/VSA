/**
 * MOCK KNOWLEDGE BASE — educational placeholder content shaped like docs/KNOWLEDGE_SCHEMA.md (expected).
 * The production Knowledge Explorer reads concepts from the API; this file is loaded only in mock mode.
 */
import type { KnowledgeConcept, KnowledgeCategory } from "@/types";

type Rel = KnowledgeConcept["related"][number];
const rel = (slug: string, relation: Rel["relation"], note?: string): Rel => ({ slug, relation, note });
const SRC = [{ title: "Frontend placeholder content", note: "Replace with backend-curated sources (see KNOWLEDGE_SCHEMA)." }];

function c(
  slug: string, name: string, category: KnowledgeCategory, summary: string, definition: string,
  x: Partial<KnowledgeConcept> & { schematic?: KnowledgeConcept["schematic"] } = {},
): KnowledgeConcept {
  return {
    slug, name, category, summary, definition,
    schematic: x.schematic ?? { kind: "none" },
    detection: x.detection ?? [],
    marketContext: x.marketContext ?? "",
    implications: x.implications ?? [],
    alternatives: x.alternatives ?? [],
    confirmation: x.confirmation ?? [],
    invalidation: x.invalidation ?? [],
    doesNotProve: x.doesNotProve,
    related: x.related ?? [],
    sources: x.sources ?? SRC,
  };
}

const shape = (variant: string) => ({ kind: "profile_shape" as const, variant });
const candle = (variant: string) => ({ kind: "candle" as const, variant });

export const KNOWLEDGE_FIXTURES: KnowledgeConcept[] = [
  // ---- Market profile shapes
  c("profile-shape-d", "D-shaped profile", "market_profile_shapes", "A symmetric, centered distribution typical of balanced trade.", "A profile whose activity is concentrated around the middle of the range and tapers evenly above and below, resembling a bell curve or the letter D.", {
    schematic: shape("D"),
    detection: ["POC near the center of the session range.", "Single dominant distribution, no clear secondary node.", "Value area covers roughly the middle of the range."],
    marketContext: "Often seen when both buyers and sellers find the same price area acceptable for most of the session.",
    implications: ["Consistent with a balanced or rotational auction.", "Edges of the value area may act as reference points for later rotations."],
    alternatives: ["A D-shape from a narrow session can sit inside a larger directional move.", "Early-session D-shapes frequently change as the day develops."],
    confirmation: ["Subsequent sessions overlap the same value area.", "Breakouts fail to hold outside the range."],
    invalidation: ["Time and volume build outside the value area (acceptance elsewhere)."],
    doesNotProve: ["That the market will remain balanced.", "Anything about participant identity."],
    related: [rel("auction-balance", "see_also"), rel("profile-shape-p", "contrasts_with"), rel("mp-value-area", "component_of")],
  }),
  c("profile-shape-p", "P-shaped profile", "market_profile_shapes", "Activity concentrated toward the upper part of the range.", "A distribution with a thick body in the upper portion of the range and a thin tail below, resembling the letter P. Often forms after a rapid advance followed by sustained trade at higher prices.", {
    schematic: shape("P"),
    detection: ["POC in the upper third of the range.", "Thin, elongated lower tail from a quick initial move.", "Value area biased toward the high end of the range."],
    marketContext: "Commonly appears after an initiative move higher, followed by acceptance (or stalling) at higher prices.",
    implications: ["One possible reading is short covering — a rapid advance driven by buyers closing positions rather than new long participation.", "Another is acceptance of higher prices as new value."],
    alternatives: ["Fresh long initiative buying can produce the same shape.", "A P-shape can precede a pullback if higher prices are later rejected.", "Different data/time resolutions can change the observed shape."],
    confirmation: ["Following sessions build value at or above the P-shape's POC.", "Pullbacks into the thin lower tail are rejected."],
    invalidation: ["Price returns into and accepts below the thin tail.", "A high-volume rejection near the highs followed by a return into prior value."],
    doesNotProve: ["Which participants caused the distribution.", "That the advance will continue or reverse."],
    related: [rel("hypothesis-short-covering", "may_lead_to"), rel("auction-acceptance-vs-excursion", "see_also"), rel("vsa-upthrust", "contradicts", "A local upthrust within a P-shape complicates the acceptance reading."), rel("profile-shape-b", "contrasts_with")],
  }),
  c("profile-shape-b", "b-shaped profile", "market_profile_shapes", "Activity concentrated toward the lower part of the range.", "A distribution with a thick body in the lower portion of the range and a thin tail above, resembling a lowercase b. Often forms after a rapid decline followed by sustained trade at lower prices.", {
    schematic: shape("b"),
    detection: ["POC in the lower third of the range.", "Thin, elongated upper tail from a quick initial move.", "Value area biased toward the low end of the range."],
    marketContext: "Commonly follows an initiative move lower that is then absorbed or accepted.",
    implications: ["May reflect long liquidation followed by acceptance of lower prices.", "May also reflect responsive buying absorbing the decline."],
    alternatives: ["Two-sided trade at lows can look identical on OHLCV-derived profiles."],
    confirmation: ["Later sessions build value around or below the POC."],
    invalidation: ["Price returns into and accepts within the thin upper tail."],
    doesNotProve: ["That liquidation (rather than new shorts) drove the move."],
    related: [rel("profile-shape-p", "contrasts_with"), rel("vsa-stopping-volume", "see_also")],
  }),
  c("profile-shape-double", "B-shaped (double distribution) profile", "market_profile_shapes", "Two separate areas of acceptance divided by a low-volume node.", "A profile with two prominent distributions separated by a low-volume area, indicating the market traded and accepted two distinct price areas.", {
    schematic: shape("B"),
    detection: ["Two peaks above a significance threshold.", "A low-volume node between them materially below both peaks."],
    marketContext: "Can occur when a balanced market transitions to a new value area during the session.",
    implications: ["The low-volume node may act as a reference where price moved quickly.", "Often interpreted as one distribution having been displaced by another."],
    alternatives: ["An intraday news event can create two distributions without a durable change in value."],
    confirmation: ["Later sessions remain in the newer distribution."],
    invalidation: ["Price returns and re-accepts the earlier distribution."],
    related: [rel("mp-hvn-lvn", "component_of"), rel("profile-shape-multi", "see_also")],
  }),
  c("profile-shape-trend", "Trend / elongated profile", "market_profile_shapes", "A narrow, stretched distribution from persistent one-directional movement.", "A profile spread across a wide range with no dominant concentration, as price moves persistently in one direction without spending time at any level.", {
    schematic: shape("trend"),
    detection: ["Wide range relative to value-area width.", "Little overlap between successive time periods."],
    marketContext: "Often accompanies strong initiative activity.",
    implications: ["Little acceptance at any one price within the move."],
    alternatives: ["A single wide-range event bar can create similar shapes."],
    confirmation: ["Continued directional moves with shallow pullbacks."],
    invalidation: ["Time and volume start to concentrate at a price."],
    related: [rel("auction-value-migration", "see_also")],
  }),
  c("profile-shape-multi", "Multi-distribution profile", "market_profile_shapes", "Three or more areas of concentration separated by low-volume nodes.", "A profile — usually a composite — containing several distinct distributions, each representing a prior area of acceptance.", {
    schematic: shape("multi"),
    detection: ["Three or more significant peaks.", "Multiple intervening low-volume nodes."],
    marketContext: "Typical of composites spanning several balance areas.",
    implications: ["Prior distributions may serve as reference areas."],
    alternatives: ["Window selection strongly influences how many distributions appear."],
    confirmation: ["Price reacts at known nodes."],
    invalidation: ["Price trades through nodes without reaction."],
    related: [rel("profile-shape-double", "see_also"), rel("mp-hvn-lvn", "component_of")],
  }),
  // ---- Market profile concepts
  c("mp-poc", "Point of Control (POC)", "market_profile_concepts", "The price with the most activity in a profile.", "The price level at which the most TPO counts (TPO profile) or the most volume (volume profile) occurred.", {
    detection: ["Max of per-price TPO count or volume."],
    marketContext: "A reference for where the market spent the most time or traded the most.",
    implications: ["Price often rotates around the POC in balanced conditions."],
    alternatives: ["TPO POC and volume POC can differ."],
    doesNotProve: ["That the POC will act as support or resistance."],
    related: [rel("mp-value-area", "component_of"), rel("vp-estimated-profile", "see_also")],
  }),
  c("mp-value-area", "Value Area (VAH / VAL)", "market_profile_concepts", "The price range containing a set share (commonly ~70%) of activity.", "The range around the POC containing a defined percentage of TPOs or volume. VAH and VAL are its upper and lower boundaries.", {
    detection: ["Expanded outward from the POC until the chosen percentage is reached."],
    marketContext: "Summarizes where the market found 'value' during the profile's period.",
    implications: ["Location relative to the previous value area frames whether price is inside value, above it or below it."],
    alternatives: ["Different percentages and algorithms yield different boundaries."],
    related: [rel("mp-poc", "component_of"), rel("auction-acceptance-vs-excursion", "see_also")],
  }),
  c("mp-initial-balance", "Initial balance (IB)", "market_profile_concepts", "The range established in the first period(s) of the session.", "The high–low range of the opening period (commonly the first hour), treated as the market's early attempt at finding balance.", {
    detection: ["High/low of the first N bars of the session."],
    marketContext: "Extensions beyond the IB are used to describe how much directional activity follows the open.",
    implications: ["A narrow IB with late extension, or a wide IB with no extension, describe different session characters."],
    alternatives: ["IB length is a convention, not a market property."],
    related: [rel("mp-value-area", "see_also")],
  }),
  c("mp-tpo", "TPO (Time Price Opportunity)", "market_profile_concepts", "A unit of time spent at a price.", "Each time period contributes one mark at every price traded within it; stacked marks form the TPO profile.", {
    detection: ["Count periods touching each price bin."],
    marketContext: "Emphasizes time at price, independent of volume.",
    alternatives: ["With coarse bars, TPOs overstate time at prices within wide bars."],
    related: [rel("vp-volume-profile", "contrasts_with")],
  }),
  c("mp-hvn-lvn", "High- and low-volume nodes", "market_profile_concepts", "Peaks and troughs in the profile.", "High-volume nodes (HVNs) are prices with concentrated activity; low-volume nodes (LVNs) are prices where little trade occurred.", {
    detection: ["Local maxima/minima of smoothed activity beyond thresholds."],
    marketContext: "HVNs reflect prior acceptance; LVNs reflect prior rapid movement.",
    implications: ["Price may move quickly through LVNs and spend time at HVNs — a tendency, not a rule."],
    alternatives: ["Node detection is sensitive to bin size and smoothing."],
    related: [rel("profile-shape-double", "component_of")],
  }),
  // ---- Volume profile
  c("vp-volume-profile", "Volume profile", "volume_profile", "Traded volume aggregated by price.", "A histogram of volume traded at each price over a period.", {
    detection: ["Requires tick/trade data for exact values."],
    marketContext: "Shows where participation concentrated.",
    alternatives: ["Without trade data, OHLCV-based estimates substitute an assumption about intrabar distribution."],
    related: [rel("vp-estimated-profile", "see_also"), rel("mp-tpo", "contrasts_with")],
  }),
  c("vp-estimated-profile", "Estimated profile", "volume_profile", "A profile derived from bars instead of trades.", "When volume-at-price is unavailable, volume from each bar is apportioned across its range by a stated assumption (e.g., uniformly). The result is an estimate, not exact traded volume at price.", {
    detection: ["Flagged by the backend with estimated = true and a method description."],
    marketContext: "Reasonable for orientation; not for precise level claims.",
    alternatives: ["Different apportioning assumptions shift POC/VAH/VAL."],
    doesNotProve: ["Exact levels of traded volume."],
    related: [rel("vp-volume-profile", "see_also")],
  }),
  // ---- VSA patterns
  c("vsa-upthrust", "Upthrust", "vsa_patterns", "A probe above a range that closes back near its low, often on high volume.", "A bar that trades above recent highs but finishes in the lower part of its range, indicating the higher prices were not held within the bar.", {
    schematic: candle("upthrust"),
    detection: ["High exceeds recent range high.", "Close in lower portion of the bar.", "Relative volume elevated; spread wider than typical."],
    marketContext: "Usually studied near the top of a range or after an advance.",
    implications: ["May reflect local rejection of higher prices (hypothesis).", "If followed by weakness, supports a failed-auction reading."],
    alternatives: ["Strong two-sided trade within an uptrend can look the same.", "Lower-timeframe context may show the bar differently."],
    confirmation: ["Following bars fail to recover the high and close lower."],
    invalidation: ["Close above the upthrust high on healthy volume."],
    doesNotProve: ["That 'smart money' is selling."],
    related: [rel("auction-failed-auction", "may_lead_to"), rel("profile-shape-p", "contradicts"), rel("vsa-effort-vs-result", "see_also")],
  }),
  c("vsa-shakeout", "Shakeout", "vsa_patterns", "A drop below support that quickly recovers.", "A bar or brief sequence that trades below a recent low or range and closes back inside, often on elevated volume.", {
    schematic: candle("shakeout"),
    detection: ["Low below recent range low.", "Close recovered into the upper half.", "Elevated volume."],
    marketContext: "Seen at the bottom of ranges or after declines.",
    implications: ["May indicate lower prices were not accepted (hypothesis)."],
    alternatives: ["Stop-run vs. accumulation cannot be distinguished from OHLCV."],
    confirmation: ["Holds above the shakeout midpoint; rotation back through value."],
    invalidation: ["Close back below the shakeout low."],
    related: [rel("auction-failed-auction", "may_lead_to"), rel("vsa-test-of-supply", "see_also")],
  }),
  c("vsa-stopping-volume", "Stopping volume", "vsa_patterns", "Heavy volume that coincides with a decline losing momentum.", "A high-volume bar within a decline that closes away from its low, suggesting the downward move met significant opposing orders.", {
    schematic: candle("stopping"),
    detection: ["High relative volume in a decline.", "Close off the low."],
    marketContext: "Studied after extended declines.",
    implications: ["May mark a slowing of the decline (hypothesis)."],
    alternatives: ["Continuation after a pause is common."],
    confirmation: ["Low-volume retest holds."],
    invalidation: ["New low on expanding volume."],
    related: [rel("vsa-selling-climax", "see_also"), rel("vsa-test-of-supply", "may_lead_to")],
  }),
  c("vsa-buying-climax", "Buying climax", "vsa_patterns", "Very high volume and wide spread at the end of an advance.", "An exceptionally high-volume, wide-spread bar after an advance, often closing off the high.", {
    schematic: candle("climax_up"),
    detection: ["Extreme relative volume after an advance.", "Wide spread; close off the high."],
    implications: ["May represent heavy supply meeting demand near highs (hypothesis)."],
    alternatives: ["Can also be a continuation burst in strong trends."],
    confirmation: ["Subsequent failure to make new highs; reaction on lower volume."],
    invalidation: ["Immediate follow-through to new highs."],
    related: [rel("vsa-selling-climax", "contrasts_with"), rel("vsa-upthrust", "see_also")],
  }),
  c("vsa-selling-climax", "Selling climax", "vsa_patterns", "Very high volume and wide spread at the end of a decline.", "An exceptionally high-volume, wide-spread bar after a decline, often closing off the low.", {
    schematic: candle("climax_down"),
    detection: ["Extreme relative volume after a decline.", "Wide spread; close off the low."],
    implications: ["May represent heavy demand absorbing supply near lows (hypothesis)."],
    alternatives: ["Capitulation may extend on following bars."],
    confirmation: ["Rally and successful low-volume retest."],
    invalidation: ["Continued lower closes on high volume."],
    related: [rel("vsa-stopping-volume", "see_also"), rel("vsa-buying-climax", "contrasts_with")],
  }),
  c("vsa-no-demand", "No demand", "vsa_patterns", "An up bar on narrow spread and low volume.", "An up-closing bar with a narrow spread and below-average volume, indicating a lack of enthusiasm in the advance.", {
    schematic: candle("no_demand"),
    detection: ["Narrow spread, low volume, up close."],
    implications: ["Weak participation in the up-move (hypothesis)."],
    alternatives: ["Quiet periods are normal; may carry no information."],
    confirmation: ["Weakness follows on expanding volume."],
    invalidation: ["Advance continues on rising volume."],
    related: [rel("vsa-no-supply", "contrasts_with")],
  }),
  c("vsa-no-supply", "No supply", "vsa_patterns", "A down bar on narrow spread and low volume.", "A down-closing bar with narrow spread and below-average volume, indicating little selling pressure on the decline.", {
    schematic: candle("no_supply"),
    detection: ["Narrow spread, low volume, down close."],
    implications: ["Lack of selling interest on the dip (hypothesis)."],
    alternatives: ["Equally consistent with disinterest overall."],
    confirmation: ["Subsequent advance on increasing volume."],
    invalidation: ["Decline continues on rising volume."],
    related: [rel("vsa-no-demand", "contrasts_with"), rel("vsa-test-of-supply", "see_also")],
  }),
  c("vsa-test-of-supply", "Test of supply", "vsa_patterns", "A retest of a prior low on reduced volume.", "A revisit of an area where heavy selling previously occurred, now on lower volume, probing whether supply remains.", {
    detection: ["Price near prior high-volume low.", "Lower volume than the original event."],
    implications: ["Reduced selling at prior supply may suggest supply has diminished (hypothesis)."],
    alternatives: ["Lower volume may reflect lower overall activity."],
    confirmation: ["Price advances away from the test."],
    invalidation: ["High volume and a close below the test low."],
    related: [rel("vsa-stopping-volume", "see_also")],
  }),
  c("vsa-high-volume-churn", "High-volume churn", "vsa_patterns", "Heavy volume with little price progress.", "Volume well above average on a bar or cluster of bars with little net movement, indicating substantial two-sided turnover.", {
    detection: ["Relative volume high; narrow spread or small net change."],
    implications: ["Large turnover without progress may signal absorption — direction unspecified."],
    alternatives: ["Can reflect rebalancing or auctions unrelated to direction."],
    related: [rel("vsa-effort-vs-result", "see_also")],
  }),
  c("vsa-effort-vs-result", "Effort versus result", "vsa_patterns", "Comparing volume (effort) to price progress (result).", "A framework: large effort with a small result, or small effort with a large result, may signal absorption or ease of movement respectively.", {
    detection: ["Relative volume vs. spread/net change disagreement."],
    implications: ["Disagreement is a prompt to look closer, not a signal."],
    alternatives: ["Spread normalization choices affect the comparison."],
    related: [rel("vsa-high-volume-churn", "see_also"), rel("vsa-upthrust", "see_also")],
  }),
  c("vsa-volume-divergence", "Volume divergence", "vsa_patterns", "Price making new extremes on diminishing volume.", "A sequence where successive price extremes occur on progressively lower volume.", {
    detection: ["New highs/lows with lower relative volume than prior extremes."],
    implications: ["May reflect waning participation (hypothesis)."],
    alternatives: ["Volume is naturally lower in some intraday periods."],
    related: [vsaRel()],
  }),
  // ---- Auction theory
  c("auction-balance", "Balance", "auction_market_theory", "Two-sided trade within an accepted range.", "A period during which price rotates within a range and neither buyers nor sellers establish durable acceptance outside it.", {
    detection: ["Overlapping value across sessions.", "Failed excursions beyond range edges."],
    implications: ["Edges may be tested; outcomes are not predetermined."],
    alternatives: ["Slow trends can resemble balance on short windows."],
    related: [rel("profile-shape-d", "see_also"), rel("auction-acceptance-vs-excursion", "see_also")],
  }),
  c("auction-acceptance-vs-excursion", "Acceptance vs. excursion", "auction_market_theory", "Briefly trading beyond a level is not the same as accepting it.", "An excursion is price reaching beyond a level. Acceptance requires time and/or volume to build there — typically multiple periods trading and closing beyond the level and subsequent trade remaining there.", {
    detection: ["Count of bars/TPOs and closes beyond the level.", "Volume participation beyond the level.", "Whether subsequent bars hold outside."],
    marketContext: "Central to deciding whether a move beyond value has produced a new area of value.",
    implications: ["Acceptance supports value migration; failure to gain acceptance supports a failed-auction reading."],
    alternatives: ["Acceptance thresholds are conventions; different thresholds change classifications."],
    confirmation: ["Continued trade and closes beyond the level."],
    invalidation: ["Return and acceptance back inside the prior value."],
    related: [rel("auction-failed-auction", "contrasts_with"), rel("auction-value-migration", "may_lead_to")],
  }),
  c("auction-failed-auction", "Failed auction", "auction_market_theory", "A move beyond a level that finds no acceptance and reverses.", "An excursion beyond a range or value edge that does not attract continued trade and returns inside, suggesting the explored prices were not accepted.", {
    detection: ["Excursion beyond a reference.", "Return inside within a short time.", "Limited time and volume outside."],
    implications: ["May increase the relevance of the opposite edge as a reference."],
    alternatives: ["Pullbacks within a trend can look like failed auctions."],
    confirmation: ["Price continues away from the failed area."],
    invalidation: ["Price re-enters and holds beyond the level."],
    related: [rel("vsa-upthrust", "see_also"), rel("vsa-shakeout", "see_also")],
  }),
  c("auction-value-migration", "Value migration", "auction_market_theory", "Value areas shifting over successive sessions.", "The progressive movement of POC/value areas higher or lower across sessions as new prices are accepted.", {
    detection: ["Successive session value areas with limited overlap and consistent direction."],
    implications: ["Describes where the market is establishing new value."],
    alternatives: ["Brief migration can reverse."],
    related: [rel("profile-shape-trend", "see_also")],
  }),
  // ---- Price action, volume & volatility
  c("pa-swing-structure", "Swing structure", "price_action", "Sequence of swing highs and lows.", "Higher highs and higher lows, lower highs and lower lows, or neither, describing the path of price.", {
    detection: ["Pivot detection over a chosen lookback."],
    alternatives: ["Pivot definitions are parameter-dependent."],
    related: [rel("auction-value-migration", "see_also")],
  }),
  c("vv-relative-volume", "Relative volume", "volume_and_volatility", "Volume compared to a recent average.", "A bar's volume divided by the average volume of the preceding N bars.", {
    detection: ["Volume ÷ trailing average."],
    marketContext: "Normalizes for instrument and time-of-day differences (when computed correctly).",
    alternatives: ["Intraday seasonality can distort naive averages."],
    related: [rel("vv-spread-and-close-location", "see_also")],
  }),
  c("vv-spread-and-close-location", "Spread and close location", "volume_and_volatility", "How wide a bar is, and where it closes within its range.", "Spread is high minus low. Close location is the close's position in the bar's range (0 = low, 1 = high).", {
    detection: ["(close − low) ÷ (high − low)."],
    alternatives: ["Highly timeframe-dependent."],
    related: [rel("vv-relative-volume", "see_also"), rel("vsa-effort-vs-result", "see_also")],
  }),
  // ---- Relationships
  c("hypothesis-short-covering", "Short-covering hypothesis", "pattern_relationships", "One possible explanation for P-shaped profiles.", "The idea that a rapid advance was driven by short positions being closed rather than by fresh long buying. It is a hypothesis: volume and price alone do not identify who traded.", {
    detection: ["Rapid initial advance, thin lower tail, subsequent stall."],
    implications: ["If true, upside follow-through may be limited once covering ends (not guaranteed)."],
    alternatives: ["New long initiative buying; or broad two-sided acceptance of higher prices."],
    confirmation: ["Stalling after the initial advance; failure to build value higher."],
    invalidation: ["Sustained acceptance and value building above the thin tail."],
    doesNotProve: ["Positioning data would be required to test this directly."],
    related: [rel("profile-shape-p", "component_of"), rel("auction-acceptance-vs-excursion", "may_lead_to"), rel("vsa-upthrust", "see_also")],
  }),
  c("relationship-p-shape-chain", "P-shape → failed-auction scenario", "pattern_relationships", "A contextual chain, not a causal rule.", "A frequently discussed sequence of relationships: a P-shaped profile may be read as short covering, which may be followed by acceptance at higher value; a subsequent upthrust contradicts that acceptance and may point to a failed-auction scenario.", {
    detection: ["P-shape, then higher-price acceptance attempt, then upthrust/rejection, then return inside value."],
    implications: ["Each link is a hypothesis; any may fail to occur."],
    alternatives: ["Acceptance may persist despite a local upthrust."],
    related: [rel("profile-shape-p", "component_of"), rel("hypothesis-short-covering", "may_lead_to"), rel("auction-acceptance-vs-excursion", "may_lead_to"), rel("vsa-upthrust", "contradicts"), rel("auction-failed-auction", "may_lead_to")],
  }),
];

function vsaRel(): Rel {
  return rel("vsa-effort-vs-result", "see_also");
}

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  market_profile_shapes: "Market Profile Shapes",
  market_profile_concepts: "Market Profile Concepts",
  volume_profile: "Volume Profile",
  vsa_patterns: "VSA Patterns",
  auction_market_theory: "Auction Market Theory",
  price_action: "Price Action",
  volume_and_volatility: "Volume and Volatility",
  pattern_relationships: "Pattern Relationships",
};
