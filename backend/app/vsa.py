from app.evidence import check, initial_status, resolve
from app.models import Bar, Evidence, Parameters

# Explicit implemented subset. Remaining concepts are browseable knowledge only.
IMPLEMENTED = {
    "stopping_volume", "selling_climax", "spring", "no_supply", "no_demand", "upthrust",
    "buying_climax", "high_volume_churn", "narrow_spread_elevated_volume",
    "wide_spread_low_volume", "volume_expansion", "volume_contraction", "compression",
    "climactic_activity", "abnormal_relative_volume", "bullish_effort_result", "bearish_effort_result",
}


def detect(bars: list[Bar], measurements, p: Parameters) -> list[Evidence]:
    observations = []
    for i, (bar, f) in enumerate(zip(bars, measurements)):
        rv, rs = f["relative_volume"], f["relative_spread"]
        if rv is None or rs is None:
            continue
        high = check("high_volume", "Elevated relative volume", "relative_volume", rv, ">=", p.high_volume, "parameters.high_volume")
        low = check("low_volume", "Low relative volume", "relative_volume", rv, "<=", p.low_volume, "parameters.low_volume")
        wide = check("wide_spread", "Wide relative spread", "relative_spread", rs, ">=", p.wide_spread, "parameters.wide_spread")
        narrow = check("narrow_spread", "Narrow relative spread", "relative_spread", rs, "<=", p.narrow_spread, "parameters.narrow_spread")
        upper = check("upper_close", "Close in upper range", "close_location", f["close_location"], ">=", 1 - p.close_extreme, "1 - parameters.close_extreme")
        lower = check("lower_close", "Close in lower range", "close_location", f["close_location"], "<=", p.close_extreme, "parameters.close_extreme")
        off_low = check("off_low_close", "Close above lower extreme", "close_location", f["close_location"], ">", p.close_extreme, "parameters.close_extreme")
        off_high = check("off_high_close", "Close below upper extreme", "close_location", f["close_location"], "<", 1 - p.close_extreme, "1 - parameters.close_extreme")
        up = check("up_background", "Prior upward background", "background", f["background"], "==", "up")
        down = check("down_background", "Prior downward background", "background", f["background"], "==", "down")
        at_low = check("at_prior_low", "Low reaches prior rolling low", "low", bar.low, "<=", f["prior_low"], "prior_low")
        at_high = check("at_prior_high", "High reaches prior rolling high", "high", bar.high, ">=", f["prior_high"], "prior_high")
        new_low = check("below_prior_low", "Low penetrates prior rolling low", "low", bar.low, "<", f["prior_low"], "prior_low")
        new_high = check("above_prior_high", "High penetrates prior rolling high", "high", bar.high, ">", f["prior_high"], "prior_high")
        recover = check("close_above_prior_low", "Close recovers prior rolling low", "close", bar.close, ">", f["prior_low"], "prior_low")
        reject = check("close_below_prior_high", "Close returns below prior rolling high", "close", bar.close, "<", f["prior_high"], "prior_high")
        up_bar = check("up_candle", "Close above open", "close", bar.close, ">", bar.open, "open")
        down_bar = check("down_candle", "Close below open", "close", bar.close, "<", bar.open, "open")
        upper_wick = check("large_upper_wick", "Large upper wick", "upper_wick", f["upper_wick"], ">=", p.wick_fraction, "parameters.wick_fraction")
        lower_wick = check("large_lower_wick", "Large lower wick", "lower_wick", f["lower_wick"], ">=", p.wick_fraction, "parameters.wick_fraction")
        tod = check("high_tod_volume", "Elevated volume for this local-time slot", "tod_relative_volume", f["tod_relative_volume"], ">=", p.high_volume, "parameters.high_volume")
        rules = {
            "stopping_volume": ("strength", [high, down, at_low, off_low]),
            "selling_climax": ("strength", [high, wide, down, at_low, upper]),
            "spring": ("strength", [new_low, recover, down, upper]),
            "no_supply": ("strength", [low, narrow, down_bar, down, off_low]),
            "no_demand": ("weakness", [low, narrow, up_bar, up, off_high]),
            "upthrust": ("weakness", [new_high, reject, up, lower, upper_wick]),
            "buying_climax": ("weakness", [high, wide, up, at_high, lower]),
            "high_volume_churn": ("neutral", [high, narrow, off_low, off_high]),
            "narrow_spread_elevated_volume": ("neutral", [high, narrow]),
            "wide_spread_low_volume": ("neutral", [low, wide]),
            "volume_expansion": ("neutral", [high]),
            "volume_contraction": ("neutral", [low]),
            "compression": ("neutral", [narrow]),
            "climactic_activity": ("neutral", [high, wide]),
            "abnormal_relative_volume": ("neutral", [tod]),
            "bullish_effort_result": ("strength", [high, down, narrow, lower_wick, at_low]),
            "bearish_effort_result": ("weakness", [high, up, narrow, upper_wick, at_high]),
        }
        baseline = check("baseline_available", "Prior volume and spread baselines available", "baseline_available", rv is not None and rs is not None, "==", True)
        history = check("minimum_history", "Minimum prior-bar history available", "baseline_bars", f["baseline_bars"], ">=", p.minimum_history, "parameters.minimum_history")
        for concept, (direction, conditions) in rules.items():
            if not all(condition.met is True for condition in conditions):
                continue
            observation = initial_status(Evidence(
                id=f"vsa:{concept}:{bar.timestamp.isoformat()}", kind="classified", concept_id=concept,
                timestamp=bar.timestamp, first_observable_at=bar.available_at,
                status="observed" if direction == "neutral" else "provisional", direction=direction,
                description=f"Rules identify {concept.replace('_', ' ')}; participant intent is unknown.",
                coordinates={"high": bar.high, "low": bar.low, "close": bar.close},
                measurements=dict(f), conditions_met=[baseline, history, *conditions]))
            if direction != "neutral":
                # Resolution is price follow-through, never proof of participant intent.
                for future_index in range(i + 1, min(len(bars), i + 1 + p.confirmation_bars)):
                    future = bars[future_index]
                    if future.session != bar.session or future.timestamp != bars[future_index - 1].available_at:
                        break
                    confirmed = future.close > bar.high if direction == "strength" else future.close < bar.low
                    invalidated = future.close < bar.low if direction == "strength" else future.close > bar.high
                    if confirmed or invalidated:
                        status = "confirmed" if confirmed else "invalidated"
                        resolve(observation, status, future.available_at,
                                "Subsequent close beyond the candidate extreme." if confirmed else "Subsequent close through the opposite extreme.")
                        observation.measurements["follow_through_close"] = future.close
                        break
                else:
                    if len(bars) > i + p.confirmation_bars:
                        resolve(observation, "expired", bars[i + p.confirmation_bars].available_at,
                                "Confirmation horizon completed without a resolving close.")
            observations.append(observation)
    return observations
