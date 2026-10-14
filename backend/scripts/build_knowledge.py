"""Generate the shipped validated catalog from concise, explicit authored entries."""
import json
from pathlib import Path

from app.models import Knowledge
from app.vsa import IMPLEMENTED

WYCKOFF = "https://www.wyckoffanalytics.com/wyckoff-method/"
PROFILE = "https://www.cqg.com/sites/default/files/archive/docs/Trading_Time.pdf"
ENGINE = "Local engine v0.1.0: operational heuristics, not source-author thresholds or validated predictive rules."

# id, category, definition, measurable conditions, context, hypothesis, alternative, follow-through
ENTRIES = [
    ("stopping_volume", "strength", "Elevated activity near a declining background's low with an off-low close.", "High relative volume; low touches prior rolling low; close not in bottom extreme.", "Declining prior closes and a local low.", "Selling may be encountering opposing interest.", "News or liquidation can produce the same bar.", "Closes above the candidate high; loss of its low weakens this view."),
    ("selling_climax", "strength", "Wide high-volume activity at a declining background's low, closing high in its range.", "High relative volume and wide relative spread; new/tied low; upper close.", "Prior decline at a local low.", "A decline may be exhausting.", "Heavy selling may continue after a temporary bounce.", "Sustained upward follow-through; a close below the candidate low invalidates the local reading."),
    ("shakeout", "strength", "A sharp excursion through support followed by recovery.", "Penetrate established support, recover, then test with reduced selling activity.", "A previously identified trading range and broader background.", "Weak holders may have been displaced; identity is unknown.", "Ordinary volatility or news-driven repricing.", "Hold recovered support; sustained loss of support weakens the interpretation."),
    ("spring", "strength", "An excursion below prior support that closes back above it.", "Low below prior rolling low; close back above it in upper range; prior down background.", "Prior decline and a measurable lower boundary; this MVP uses a rolling low proxy.", "Lower prices may have been rejected.", "A temporary bounce can precede another decline.", "Close above the excursion high; close below its low invalidates the local reading."),
    ("successful_test_supply", "strength", "A subsequent low-activity test of a prior strength observation with upward follow-through.", "Prior strength candidate; lower activity on revisit; subsequent upward progress.", "Identified prior strength and tested price region.", "Selling pressure may have diminished.", "Low activity may reflect absent participation on both sides.", "Later upward progress while retaining the test low."),
    ("no_supply", "strength", "A narrow low-volume down candle with an off-low close in a declining background.", "Low relative volume; narrow spread; close below open and not in bottom extreme.", "Prior down background; broader support and previous strength improve interpretation.", "Available selling may be limited.", "Illiquidity or inactivity can explain the same observation.", "Close above the candidate high; loss of its low weakens the reading."),
    ("low_volume_pullback", "strength", "A countertrend retracement on diminished activity.", "Established uptrend; downward retracement; volume below comparable prior activity.", "A confirmed upward structure.", "Countertrend selling may be weak.", "Demand may also have disappeared.", "Resumption above pullback high while retaining its low."),
    ("bullish_effort_result", "strength", "High activity with a narrow range and lower wick at a declining background's local low.", "High relative volume, narrow relative spread, large lower wick, local low, prior decline.", "Down background at local support proxy.", "Selling effort may meet opposing interest.", "High turnover without durable support.", "Upward follow-through beyond candidate high; loss of its low weakens this view."),
    ("absorption_selling", "strength", "Repeated selling activity with limited downward progress.", "Multiple tests of a region with activity but diminishing downward displacement.", "Repeated comparable support tests.", "Opposing interest may be absorbing selling.", "A pause before further liquidation.", "Retain the region and progress higher; sustained loss of it invalidates the local view."),
    ("buying_climax", "weakness", "Wide high-volume activity at an advancing background's high, closing low in its range.", "High relative volume and wide spread; new/tied local high; lower close.", "Prior advance at a local high.", "An advance may be exhausting.", "A pause during continuing strength.", "Downward follow-through; a close above the high weakens the reading."),
    ("upthrust", "weakness", "Excursion above a prior high followed by a lower close and large upper wick.", "High above rolling prior high; close back below, in lower range; large upper wick.", "Prior upward background and a known upper boundary proxy.", "Higher prices may have been rejected locally.", "Profit-taking within a continuing advance.", "Close below the candidate low; recovery above its high weakens the reading."),
    ("failed_upward_breakout", "weakness", "An upward breakout attempt that cannot sustain the broken region.", "Known resistance; penetration; return beneath it; failed recovery.", "Established upper boundary and attempted breakout.", "Upward auction may have failed.", "Temporary retracement before acceptance.", "Continued lower closes; sustained recovery invalidates the failed-breakout reading."),
    ("no_demand", "weakness", "A narrow low-volume up candle with an off-high close in an advancing background.", "Low relative volume; narrow spread; close above open but not in upper extreme.", "Prior upward background; resistance and previous weakness improve interpretation.", "Buying interest may be limited.", "A quiet advance can occur with little available selling.", "Close below candidate low; recovery above its high weakens the reading."),
    ("supply_entering", "weakness", "Increasing activity accompanies reduced upward progress.", "Compare several upward bars for increased activity and decreasing displacement.", "An advance into a known resistance region.", "Opposing selling may be increasing.", "Routine profit-taking without a durable transition.", "Lower follow-through; sustained upward progress weakens the reading."),
    ("high_volume_rejection", "weakness", "A high-volume excursion above a reference that fails to retain higher prices.", "Known reference; high relative volume; excursion above and close below.", "Measurable upper reference and upward attempt.", "Higher-price auction may be failing.", "Transient volatility around news.", "Lower follow-through; acceptance above the reference weakens the reading."),
    ("bearish_effort_result", "weakness", "High activity with narrow range and an upper wick at an advancing background's local high.", "High volume, narrow spread, large upper wick, local high, prior advance.", "Up background at local resistance proxy.", "Buying effort may meet opposing interest.", "Heavy turnover within a continuing advance.", "Downward follow-through; recovery above candidate high weakens the reading."),
    ("absorption_buying", "weakness", "Repeated buying activity with limited upward progress.", "Multiple comparable resistance tests with activity but diminishing upward displacement.", "Repeated tests of resistance.", "Opposing interest may be absorbing buying.", "Consolidation before continued advance.", "Failure below resistance; sustained acceptance above it invalidates the local view."),
    ("high_volume_churn", "neutral", "Elevated volume with narrow spread and a middle-range close.", "High relative volume; narrow relative spread; close away from both extremes.", "Comparable prior-volume and spread baselines.", "Substantial activity achieved limited range expansion.", "Ordinary two-sided liquidity or rebalance activity.", "Subsequent expansion establishes context; no direction is implied."),
    ("narrow_spread_elevated_volume", "neutral", "Elevated volume coincides with narrow spread.", "High relative volume; narrow relative spread.", "Sufficient prior baseline.", "Activity and range expansion diverge.", "Routine liquidity concentration.", "Later progress or rejection distinguishes interpretations."),
    ("wide_spread_low_volume", "neutral", "Wide spread coincides with low relative volume.", "Wide relative spread; low relative volume.", "Sufficient prior baseline.", "Price moved with relatively little observed activity.", "Sparse liquidity or ordinary volatility.", "Later acceptance or reversal determines context."),
    ("volume_expansion", "neutral", "Volume is elevated relative to prior bars.", "Volume divided by prior-only moving average reaches high_volume.", "Sufficient prior bars; time of day may explain activity.", "Participation increased relative to this baseline.", "Session-open or close effects, news, and auctions.", "Compare subsequent volume and directional progress."),
    ("volume_contraction", "neutral", "Volume is reduced relative to prior bars.", "Volume divided by prior-only moving average is below low_volume.", "Sufficient prior baseline; session context.", "Participation decreased relative to this baseline.", "Lunch-hour seasonality or missing provider activity.", "Compare later activity and price progress."),
    ("climactic_activity", "neutral", "Wide spread and high relative volume occur together.", "High relative volume; wide relative spread.", "Sufficient prior baseline; no directional conclusion without location.", "Unusually active price expansion.", "News or persistent trend continuation.", "Subsequent follow-through or rejection establishes context."),
    ("compression", "neutral", "Current spread is narrow relative to prior spreads.", "Prior-only relative spread below narrow_spread.", "Sufficient baseline; single-bar proxy rather than a full consolidation detector.", "Current range contracted.", "Quiet session periods or sparse trading.", "Later sustained expansion may resolve compression."),
    ("volume_divergence", "neutral", "Volume activity and price progress differ across comparable swings.", "Compare confirmed swings, displacement and activity under a fixed measurement window.", "Comparable multi-bar swings.", "The relationship between effort and result changed.", "Seasonality, liquidity, or corporate actions.", "Subsequent price behavior; divergence alone gives no direction."),
    ("abnormal_relative_volume", "neutral", "Volume is elevated versus the same local-time slot in prior sessions.", "Same-slot relative volume reaches high_volume after tod_minimum_sessions.", "Enough prior New York time-slot history, without using the current bar in the baseline.", "Activity is unusual for this time of day.", "News, index rebalancing, or non-comparable sessions.", "Evaluate persistence and price progress; no directional conclusion follows alone."),
]


def build():
    concepts = []
    for id_, category, definition, conditions, context, hypothesis, alternative, follow in ENTRIES:
        concepts.append(dict(id=id_, name=id_.replace("_", " ").title(), category=category, definition=definition,
                             historical_origin_or_source=[WYCKOFF, ENGINE], observable_conditions=[conditions],
                             required_background=[context], preferred_price_location=[context],
                             volume_characteristics=["Use the stated prior-only relative-volume conditions; thresholds are local engine heuristics."],
                             spread_characteristics=["Use range high minus low and the stated prior-only relative-spread conditions."],
                             close_location_characteristics=["Close location is (close-low)/(high-low); zero-range bars use 0.5."],
                             possible_interpretations=[hypothesis], alternative_explanations=[alternative],
                             confirmation_conditions=[follow], invalidation_conditions=["Opposite price follow-through weakens directional hypotheses; neutral observations are measurements rather than forecasts."],
                             known_limitations=["OHLCV cannot prove institutional intent or order flow.", "These are operational definitions, not a verbatim or exhaustive VSA doctrine.",
                                                "Rule confirmation means price follow-through, not confirmation of motives."],
                             related_patterns=["volume_expansion"] if id_ != "volume_expansion" else ["volume_contraction"],
                             detector_status="implemented" if id_ in IMPLEMENTED else "knowledge_only"))
    extra = [
        ("profile_shapes", "profile", "Numerical descriptors of estimated time or volume distributions; D, P, b, B, elongated, multimodal or unclassified.", "Skewness, separated peaks, concentration and directional progress; all heuristic.", PROFILE, "implemented"),
        ("auction_state", "auction", "Observable classifications of closes relative to frozen prior-session estimated value.", "Consecutive closes beyond value indicate acceptance; return inside indicates rejection.", PROFILE, "implemented"),
        ("breakout", "price_action", "Close beyond a prior rolling high or low.", "Close outside a prior-only rolling boundary after minimum history.", WYCKOFF, "implemented"),
        ("failed_breakout", "price_action", "Intrabar penetration of a rolling boundary followed by a close back inside.", "Range exceeds the boundary; close returns inside. This MVP is a single-bar failure proxy.", WYCKOFF, "implemented"),
        ("rejection_wick", "price_action", "A wick occupies a configurable fraction of the candle range.", "Upper or lower wick fraction reaches wick_fraction.", ENGINE, "implemented"),
        ("swing_structure", "price_action", "Strict local pivot compared with previously confirmed same-side pivots.", "Pivot confirmed only after pivot_bars right-hand bars close; tied extrema are excluded.", ENGINE, "implemented"),
        ("data_requirements", "data", "Timestamped consistent OHLCV and declared session and split-adjustment basis.", "Finite consistent OHLC; nonnegative volume; strictly ordered timestamps on exchange session grids.", ENGINE, "implemented"),
        ("common_misconceptions", "limitations", "Profile shapes and VSA observations do not establish participant intent or predictive certainty.", "Estimated profiles cannot reconstruct exact trade-at-price or aggressor flow.", ENGINE, "knowledge_only"),
    ]
    for id_, category, definition, conditions, source, status in extra:
        concepts.append(dict(id=id_, name=id_.replace("_", " ").title(), category=category, definition=definition,
                             historical_origin_or_source=[source, ENGINE], observable_conditions=[conditions],
                             required_background=["Validated, consistently adjusted completed bars."],
                             preferred_price_location=["Relative to the relevant observed reference region."],
                             volume_characteristics=["OHLCV aggregate volume, not trade-at-price."],
                             spread_characteristics=["High minus low."], close_location_characteristics=["Range-relative close."],
                             possible_interpretations=["Contextual description of the available data."],
                             alternative_explanations=["Missing data, ordinary volatility or different binning can alter the classification."],
                             confirmation_conditions=["Additional completed data consistent with the classification."],
                             invalidation_conditions=["Observed behavior contradicts the stated operational rule."],
                             known_limitations=["No prediction or participant identity follows from these measurements."],
                             related_patterns=["common_misconceptions"] if id_ != "common_misconceptions" else ["data_requirements"],
                             detector_status=status))
    return Knowledge.model_validate({"version": "1.0.0", "concepts": concepts})


if __name__ == "__main__":
    target = Path(__file__).resolve().parents[1] / "app/knowledge/concepts.json"
    target.write_text(build().model_dump_json(indent=2) + "\n", encoding="utf-8")
