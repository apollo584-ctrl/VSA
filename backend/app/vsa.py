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
        high, low = rv >= p.high_volume, rv <= p.low_volume
        wide, narrow = rs >= p.wide_spread, rs <= p.narrow_spread
        upper, lower = f["close_location"] >= 1 - p.close_extreme, f["close_location"] <= p.close_extreme
        up, down = f["background"] == "up", f["background"] == "down"
        at_low = f["prior_low"] is not None and bar.low <= f["prior_low"]
        at_high = f["prior_high"] is not None and bar.high >= f["prior_high"]
        rules = {
            "stopping_volume": (high and down and at_low and not lower, "strength"),
            "selling_climax": (high and wide and down and at_low and upper, "strength"),
            "spring": (bar.low < f["prior_low"] and bar.close > f["prior_low"] and down and upper, "strength"),
            "no_supply": (low and narrow and bar.close < bar.open and down and not lower, "strength"),
            "no_demand": (low and narrow and bar.close > bar.open and up and not upper, "weakness"),
            "upthrust": (bar.high > f["prior_high"] and bar.close < f["prior_high"] and up and lower
                         and f["upper_wick"] >= p.wick_fraction, "weakness"),
            "buying_climax": (high and wide and up and at_high and lower, "weakness"),
            "high_volume_churn": (high and narrow and p.close_extreme < f["close_location"] < 1 - p.close_extreme, "neutral"),
            "narrow_spread_elevated_volume": (high and narrow, "neutral"),
            "wide_spread_low_volume": (low and wide, "neutral"),
            "volume_expansion": (high, "neutral"),
            "volume_contraction": (low, "neutral"),
            "compression": (narrow, "neutral"),
            "climactic_activity": (high and wide, "neutral"),
            "abnormal_relative_volume": (f["tod_relative_volume"] is not None and f["tod_relative_volume"] >= p.high_volume, "neutral"),
            "bullish_effort_result": (high and down and narrow and f["lower_wick"] >= p.wick_fraction and at_low, "strength"),
            "bearish_effort_result": (high and up and narrow and f["upper_wick"] >= p.wick_fraction and at_high, "weakness"),
        }
        for concept, (triggered, direction) in rules.items():
            if not triggered:
                continue
            observation = Evidence(
                id=f"vsa:{concept}:{bar.timestamp.isoformat()}", kind="classified", concept_id=concept,
                timestamp=bar.timestamp, first_observable_at=bar.available_at,
                status="observed" if direction == "neutral" else "provisional", direction=direction,
                description=f"Rules identify {concept.replace('_', ' ')}; participant intent is unknown.",
                coordinates={"high": bar.high, "low": bar.low, "close": bar.close}, measurements=f)
            if direction != "neutral":
                # Confirmation means subsequent price follow-through, not proof of the hypothesis.
                for future_index in range(i + 1, min(len(bars), i + 1 + p.confirmation_bars)):
                    future = bars[future_index]
                    if future.session != bar.session or future.timestamp != bars[future_index - 1].available_at:
                        break
                    confirmed = future.close > bar.high if direction == "strength" else future.close < bar.low
                    invalidated = future.close < bar.low if direction == "strength" else future.close > bar.high
                    if confirmed or invalidated:
                        observation.status = "confirmed" if confirmed else "invalidated"
                        observation.confirmed_at = future.available_at if confirmed else None
                        observation.measurements["resolved_at"] = future.available_at.isoformat()
                        observation.measurements["follow_through_close"] = future.close
                        break
                else:
                    if len(bars) > i + p.confirmation_bars:
                        observation.status = "expired"
            observations.append(observation)
    return observations
