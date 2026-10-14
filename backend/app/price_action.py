from app.models import Bar, Evidence, Parameters


def detect(bars: list[Bar], features, p: Parameters) -> list[Evidence]:
    observations = []
    pivots = {"high": [], "low": []}
    for i, bar in enumerate(bars):
        f = features[i]
        rules = []
        if f["prior_high"] is not None:
            if bar.close > f["prior_high"]:
                rules.append(("breakout", "strength", "Close above prior rolling high", {"level": f["prior_high"]}))
            elif bar.high > f["prior_high"] and bar.close < f["prior_high"]:
                rules.append(("failed_breakout", "weakness", "Higher range rejected at prior rolling high", {"level": f["prior_high"]}))
            if bar.close < f["prior_low"]:
                rules.append(("breakout", "weakness", "Close below prior rolling low", {"level": f["prior_low"]}))
            elif bar.low < f["prior_low"] and bar.close > f["prior_low"]:
                rules.append(("failed_breakout", "strength", "Lower range rejected at prior rolling low", {"level": f["prior_low"]}))
        if f["upper_wick"] >= p.wick_fraction or f["lower_wick"] >= p.wick_fraction:
            rules.append(("rejection_wick", "neutral", "Large wick; OHLC alone does not prove rejection intent", {}))
        for j, (concept, direction, description, coordinates) in enumerate(rules):
            observations.append(Evidence(id=f"pa:{concept}:{i}:{j}", kind="classified", concept_id=concept,
                                         timestamp=bar.timestamp, first_observable_at=bar.available_at,
                                         status="observed", direction=direction, description=description,
                                         coordinates=coordinates, measurements=f))
        # Pivot at i-k is not observable until i closes; never backdate confirmation.
        k = p.pivot_bars
        if i >= 2 * k:
            candidate = bars[i - k]
            window = bars[i - 2 * k:i + 1]
            if any(a.available_at != b.timestamp or a.session != b.session for a, b in zip(window, window[1:])):
                continue
            for side in ("high", "low"):
                value = getattr(candidate, side)
                others = [getattr(b, side) for n, b in enumerate(window) if n != k]
                if (side == "high" and value > max(others)) or (side == "low" and value < min(others)):
                    previous = pivots[side][-1] if pivots[side] else None
                    relation = ("higher_" if value > previous else "lower_" if value < previous else "equal_") + side if previous is not None else "swing_" + side
                    pivots[side].append(value)
                    observations.append(Evidence(id=f"pa:pivot:{side}:{i-k}", kind="classified", concept_id="swing_structure",
                                                 timestamp=candidate.timestamp, first_observable_at=bar.available_at,
                                                 confirmed_at=bar.available_at, status="confirmed",
                                                 description=relation, coordinates={"price": value},
                                                 measurements={"relation": relation, "right_bars": float(k)}))
    return observations
