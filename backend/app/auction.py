"""Transitions use a frozen previous complete session, never its future bars."""
from app.models import AuctionState, Bar, Evidence, Parameters, Profile
from app.data import calendar


def classify(bars: list[Bar], session_profiles: list[Profile], complete_sessions: set[str], p: Parameters) -> AuctionState:
    by_session = {item.session: item for item in session_profiles}
    cal = calendar(bars[0].session, bars[-1].session)
    transitions = []
    previous_session = None
    reference = None
    state = "indeterminate"
    above = below = 0
    last_bar = None
    for i, bar in enumerate(bars):
        if bar.session != previous_session:
            expected_previous = cal.previous_session(bar.session).strftime("%Y-%m-%d")
            reference = by_session.get(previous_session) if previous_session == expected_previous and previous_session in complete_sessions else None
            previous_session = bar.session
            state = "indeterminate"
            above = below = 0
        if last_bar is not None and last_bar.available_at != bar.timestamp:
            above = below = 0
        last_bar = bar
        if reference is None or reference.volume.vah is None:
            continue
        vah, val = reference.volume.vah, reference.volume.val
        old = state
        if bar.close > vah:
            above += 1
            below = 0
            state = "higher_price_acceptance" if above >= p.acceptance_bars else "upward_breakout_attempt"
        elif bar.close < val:
            below += 1
            above = 0
            state = "lower_price_acceptance" if below >= p.acceptance_bars else "downward_breakout_attempt"
        else:
            if old in ("upward_breakout_attempt", "higher_price_acceptance"):
                state = "rejection_above_value"
            elif old in ("downward_breakout_attempt", "lower_price_acceptance"):
                state = "rejection_below_value"
            else:
                state = "balance"
            above = below = 0
        if state != old:
            transitions.append(Evidence(id=f"auction:{i}", kind="classified", concept_id="auction_state",
                                        timestamp=bar.timestamp, first_observable_at=bar.available_at, status="observed",
                                        description=f"{old} → {state}",
                                        coordinates={"prior_vah": vah, "prior_val": val, "close": bar.close},
                                        measurements={"above_closes": float(above), "below_closes": float(below),
                                                      "reference_session": reference.session},
                                        supporting_evidence=[reference.id]))
    current_timestamps = {bar.timestamp for bar in bars if bar.session == bars[-1].session}
    current = [t.id for t in transitions if t.timestamp in current_timestamps]
    return AuctionState(state=state, evidence_ids=current[-1:], transitions=transitions)
