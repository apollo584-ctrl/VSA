"""Price location relative to the previous complete session's value area, frozen at each observation's first-observable bar."""
from app.auction import prior_reference
from app.data import calendar
from app.models import Bar, Evidence, Profile, ValueLocation


def reference_table(bars: list[Bar], session_profiles: list[Profile], complete_sessions: set[str]) -> dict[str, tuple[Profile | None, str | None]]:
    """Per session: the reference profile the auction uses and, when unusable, why. Uses only visible, finished sessions."""
    by_session = {item.session: item for item in session_profiles}
    cal = calendar(bars[0].session, bars[-1].session)
    table = {}
    previous = None
    for bar in bars:
        if bar.session == previous:
            continue
        expected = cal.previous_session(bar.session).strftime("%Y-%m-%d")
        reference = prior_reference(previous, expected, by_session, complete_sessions)
        if previous is None:
            reason = "no_prior_session"
        elif previous != expected:
            reason = "prior_session_not_adjacent"
        elif previous not in complete_sessions:
            reason = "prior_session_incomplete"
        elif reference is None or reference.volume.vah is None or reference.volume.val is None:
            reason = "prior_value_area_unavailable"
            reference = None
        else:
            reason = None
        table[bar.session] = (reference if reason is None else None, reason)
        previous = bar.session
    return table


def locate(bar: Bar, table: dict[str, tuple[Profile | None, str | None]]) -> ValueLocation:
    reference, reason = table[bar.session]
    if reference is None:
        return ValueLocation(state="unavailable", price=bar.close, as_of=bar.available_at, unavailable_reason=reason)
    vah, val = reference.volume.vah, reference.volume.val
    state = "above_value" if bar.close > vah else "below_value" if bar.close < val else "inside_value"
    return ValueLocation(state=state, price=bar.close, as_of=bar.available_at, reference_session=reference.session,
                         val=val, vah=vah, poc=reference.volume.poc)


def annotate(observations: list[Evidence], bars: list[Bar], table) -> None:
    """Attach the location known when each observation first became observable (the bar that closed at that moment)."""
    closed_at = {bar.available_at: bar for bar in bars}
    for item in observations:
        bar = closed_at.get(item.first_observable_at)
        if bar is not None:
            item.value_location = locate(bar, table)
