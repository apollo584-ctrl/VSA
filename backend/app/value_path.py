"""Developing value path and session-to-session value relationship, both strictly causal.

The developing path recomputes the session's volume profile from only the bars that had closed at each step.
The relationship compares a session's value area with the previous scheduled, complete session's; the
current session's relationship is provisional because its profile is still developing.
"""
from app.data import calendar
from app.models import Bar, DevelopingPoint, DevelopingProfile, Parameters, Profile, Source, ValueMigrationStep
from app.profiles import profile


def developing_profile(bars: list[Bar], source: Source, p: Parameters) -> DevelopingProfile | None:
    session = bars[-1].session
    today = [b for b in bars if b.session == session]
    points = []
    for k in range(len(today)):
        levels = profile(today[:k + 1], source, p).volume
        if levels.poc is None or levels.vah is None or levels.val is None:
            continue
        points.append(DevelopingPoint(timestamp=today[k].timestamp, available_at=today[k].available_at,
                                      poc=levels.poc, vah=levels.vah, val=levels.val))
    return DevelopingProfile(session=session, points=points) if points else None


def relationship(profile_now: Profile, reference: Profile) -> str | None:
    now, ref = profile_now.volume, reference.volume
    if None in (now.poc, now.vah, now.val, ref.poc, ref.vah, ref.val):
        return None
    if now.val > ref.vah:
        return "higher_value"
    if now.vah < ref.val:
        return "lower_value"
    return "overlapping_higher" if now.poc > ref.poc else "overlapping_lower" if now.poc < ref.poc else "overlapping_unchanged"


def value_migration(session_profiles: list[Profile], complete_sessions: set[str]) -> list[ValueMigrationStep]:
    """One step per session after the first; `final` is false for a session still in progress."""
    by_session = {item.session: item for item in session_profiles}
    cal = calendar(session_profiles[0].session, session_profiles[-1].session)
    steps = []
    for item in session_profiles[1:]:
        expected = cal.previous_session(item.session).strftime("%Y-%m-%d")
        reference = by_session.get(expected)
        reason = None
        if reference is None:
            reason = "prior_session_not_adjacent"
        elif expected not in complete_sessions:
            reason = "prior_session_incomplete"
        rel = None if reason else relationship(item, reference)
        if reason is None and rel is None:
            reason = "prior_value_area_unavailable"
        steps.append(ValueMigrationStep(
            session=item.session, previous_session=expected if reference else None, relationship=rel, unavailable_reason=reason,
            final=item.session in complete_sessions, poc=item.volume.poc, vah=item.volume.vah, val=item.volume.val,
            prior_poc=reference.volume.poc if rel else None, prior_vah=reference.volume.vah if rel else None,
            prior_val=reference.volume.val if rel else None))
    return steps
