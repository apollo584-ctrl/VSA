"""Transitions use a frozen previous complete session, never its future bars."""
from app.models import AuctionState, Bar, Evidence, Parameters, Profile, SessionReset
from app.data import calendar
from app.evidence import check, initial_status


def classify(bars: list[Bar], session_profiles: list[Profile], complete_sessions: set[str], p: Parameters) -> AuctionState:
    by_session = {item.session: item for item in session_profiles}
    cal = calendar(bars[0].session, bars[-1].session)
    transitions = []
    resets = []
    previous_session = None
    reference = None
    state = "indeterminate"
    above = below = 0
    last_bar = None
    for i, bar in enumerate(bars):
        if bar.session != previous_session:
            expected_previous = cal.previous_session(bar.session).strftime("%Y-%m-%d")
            reference = by_session.get(previous_session) if previous_session == expected_previous and previous_session in complete_sessions else None
            if previous_session is not None:
                resets.append(session_reset(bar, previous_session, state, expected_previous, reference, complete_sessions))
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
        above_value = check("close_above_value", "Close above prior value", "close", bar.close, ">", vah, "prior_vah")
        below_value = check("close_below_value", "Close below prior value", "close", bar.close, "<", val, "prior_val")
        if above_value.met is True:
            above += 1
            below = 0
            acceptance = check("above_close_count", "Consecutive closes above value", "above_closes", above, ">=", p.acceptance_bars, "parameters.acceptance_bars")
            state = "higher_price_acceptance" if acceptance.met is True else "upward_breakout_attempt"
            count = acceptance if acceptance.met is True else check("above_close_count", "Acceptance count not yet reached", "above_closes", above, "<", p.acceptance_bars, "parameters.acceptance_bars")
            conditions = [above_value, count]
        elif below_value.met is True:
            below += 1
            above = 0
            acceptance = check("below_close_count", "Consecutive closes below value", "below_closes", below, ">=", p.acceptance_bars, "parameters.acceptance_bars")
            state = "lower_price_acceptance" if acceptance.met is True else "downward_breakout_attempt"
            count = acceptance if acceptance.met is True else check("below_close_count", "Acceptance count not yet reached", "below_closes", below, "<", p.acceptance_bars, "parameters.acceptance_bars")
            conditions = [below_value, count]
        else:
            conditions = [check("close_at_or_above_val", "Close at or above prior VAL", "close", bar.close, ">=", val, "prior_val"),
                          check("close_at_or_below_vah", "Close at or below prior VAH", "close", bar.close, "<=", vah, "prior_vah")]
            if old in ("upward_breakout_attempt", "higher_price_acceptance"):
                state = "rejection_above_value"
                previous_states = ["upward_breakout_attempt", "higher_price_acceptance"]
            elif old in ("downward_breakout_attempt", "lower_price_acceptance"):
                state = "rejection_below_value"
                previous_states = ["downward_breakout_attempt", "lower_price_acceptance"]
            else:
                state = "balance"
                previous_states = ["indeterminate", "balance", "rejection_above_value", "rejection_below_value"]
            conditions.append(check("previous_state", "Previous auction classification", "previous_state", old, "in", previous_states))
            above = below = 0
        if state != old:
            conditions.extend([check("reference_session", "Reference is the previous scheduled session", "reference_session", reference.session, "==", expected_previous, "calendar.previous_session"),
                               check("complete_reference", "Reference session is complete", "reference_complete", reference.session in complete_sessions, "==", True)])
            transitions.append(initial_status(Evidence(id=f"auction:{i}", kind="classified", concept_id="auction_state",
                                        timestamp=bar.timestamp, first_observable_at=bar.available_at, status="observed",
                                        description=f"{old} → {state}",
                                        coordinates={"prior_vah": vah, "prior_val": val, "close": bar.close},
                                        measurements={"above_closes": float(above), "below_closes": float(below),
                                                      "reference_session": reference.session},
                                        supporting_evidence=[reference.id], conditions_met=conditions)))
    current_timestamps = {bar.timestamp for bar in bars if bar.session == bars[-1].session}
    current = [t.id for t in transitions if t.timestamp in current_timestamps]
    return AuctionState(state=state, evidence_ids=current[-1:], transitions=transitions, session_resets=resets)


def session_reset(bar: Bar, previous_session: str, previous_state: str, expected_previous: str,
                  reference: Profile | None, complete_sessions: set[str]) -> SessionReset:
    """Record the boundary using only the first bar of the new session and the already-finished prior session."""
    reason = None
    if previous_session != expected_previous:
        reason = "prior_session_not_adjacent"
    elif previous_session not in complete_sessions:
        reason = "prior_session_incomplete"
    elif reference is None or reference.volume.vah is None:
        reason = "prior_value_area_unavailable"
    detail = f"Prior value from {reference.session} is available." if reason is None else f"No usable prior value ({reason.replace('_', ' ')})."
    return SessionReset(id=f"auction_reset:{bar.session}", session=bar.session, previous_session=previous_session,
                        timestamp=bar.timestamp, first_observable_at=bar.available_at, previous_state=previous_state,
                        reference_session=reference.session if reason is None and reference is not None else None,
                        reference_usable=reason is None, reference_unavailable_reason=reason,
                        description=f"New session {bar.session}: auction state restarts from {previous_state} to indeterminate. {detail}")
