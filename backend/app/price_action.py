from app.models import Bar, Evidence, Parameters
from app.evidence import check, initial_status


def detect(bars: list[Bar], features, p: Parameters) -> list[Evidence]:
    observations = []
    pivots = {"high": [], "low": []}
    for i, bar in enumerate(bars):
        f = features[i]
        rules = []
        if f["prior_high"] is not None:
            above = check("close_above_prior_high", "Close above prior rolling high", "close", bar.close, ">", f["prior_high"], "prior_high")
            below = check("close_below_prior_low", "Close below prior rolling low", "close", bar.close, "<", f["prior_low"], "prior_low")
            upper_failure = [check("high_above_prior_high", "High above prior rolling high", "high", bar.high, ">", f["prior_high"], "prior_high"),
                             check("close_below_prior_high", "Close back below prior rolling high", "close", bar.close, "<", f["prior_high"], "prior_high")]
            lower_failure = [check("low_below_prior_low", "Low below prior rolling low", "low", bar.low, "<", f["prior_low"], "prior_low"),
                             check("close_above_prior_low", "Close back above prior rolling low", "close", bar.close, ">", f["prior_low"], "prior_low")]
            if above.met is True:
                rules.append(("breakout", "strength", "Close above prior rolling high", {"level": f["prior_high"]}, [above]))
            elif all(c.met is True for c in upper_failure):
                rules.append(("failed_breakout", "weakness", "Higher range rejected at prior rolling high", {"level": f["prior_high"]}, upper_failure))
            if below.met is True:
                rules.append(("breakout", "weakness", "Close below prior rolling low", {"level": f["prior_low"]}, [below]))
            elif all(c.met is True for c in lower_failure):
                rules.append(("failed_breakout", "strength", "Lower range rejected at prior rolling low", {"level": f["prior_low"]}, lower_failure))
        wick = check("large_wick", "Upper or lower wick reaches threshold", "max_wick_fraction", max(f["upper_wick"], f["lower_wick"]), ">=", p.wick_fraction, "parameters.wick_fraction")
        if wick.met is True:
            rules.append(("rejection_wick", "neutral", "Large wick; OHLC alone does not prove rejection intent", {}, [wick]))
        for j, (concept, direction, description, coordinates, conditions) in enumerate(rules):
            observations.append(initial_status(Evidence(id=f"pa:{concept}:{i}:{j}", kind="classified", concept_id=concept,
                                         timestamp=bar.timestamp, first_observable_at=bar.available_at,
                                         status="observed", direction=direction, description=description,
                                         coordinates=coordinates, measurements=dict(f), conditions_met=conditions)))
        # Pivot at i-k is not observable until i closes; never backdate confirmation.
        k = p.pivot_bars
        if i >= 2 * k:
            candidate = bars[i - k]
            window = bars[i - 2 * k:i + 1]
            contiguous = all(a.available_at == b.timestamp and a.session == b.session for a, b in zip(window, window[1:]))
            if not contiguous:
                continue
            for side in ("high", "low"):
                value = getattr(candidate, side)
                others = [getattr(b, side) for n, b in enumerate(window) if n != k]
                pivot = check("strict_pivot", "Pivot exceeds all neighboring extrema", f"pivot_{side}", value, ">" if side == "high" else "<", max(others) if side == "high" else min(others), f"neighbor_{side}_extreme")
                if pivot.met is True:
                    previous = pivots[side][-1] if pivots[side] else None
                    relation = ("higher_" if value > previous else "lower_" if value < previous else "equal_") + side if previous is not None else "swing_" + side
                    pivots[side].append(value)
                    observations.append(initial_status(Evidence(id=f"pa:pivot:{side}:{i-k}", kind="classified", concept_id="swing_structure",
                                                 timestamp=candidate.timestamp, first_observable_at=bar.available_at,
                                                 confirmed_at=bar.available_at, resolved_at=bar.available_at, status="confirmed",
                                                 description=relation, coordinates={"price": value},
                                                 measurements={"relation": relation, "right_bars": float(k)},
                                                 conditions_met=[pivot,
                                                     check("right_bars", "Required right-hand bars have closed", "right_bars", float(len(window) - k - 1), ">=", p.pivot_bars, "parameters.pivot_bars"),
                                                     check("contiguous_window", "Same-session contiguous pivot window", "contiguous_window", contiguous, "==", True)])))
    return observations
