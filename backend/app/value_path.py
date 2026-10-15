"""Developing value path and session-to-session value relationship, both strictly causal.

The developing path accumulates volume from only the bars that had closed at each step.
The relationship compares a session's value area with the previous scheduled, complete session's; the
current session's relationship is provisional because its profile is still developing.
"""
from app.data import calendar
from app.models import Bar, DevelopingPoint, DevelopingProfile, Parameters, Profile, Source, ValueMigrationStep
from decimal import Decimal, ROUND_FLOOR

import numpy as np

from app.profiles import ProfileLimitError, value_area_indices


def developing_profile(bars: list[Bar], source: Source, p: Parameters) -> DevelopingProfile | None:
    session = bars[-1].session
    today = [b for b in bars if b.session == session]
    if p.tpo_minutes < source.timeframe_minutes or p.tpo_minutes % source.timeframe_minutes:
        raise ValueError("TPO interval must be a multiple of the bar timeframe and at least as large")
    def index(price):
        return int((Decimal(str(price)) / Decimal(str(p.bin_size))).to_integral_value(rounding=ROUND_FLOOR))
    points = []
    lower = upper = index(today[0].low)
    volumes = np.zeros(1)
    for bar in today:
        lo, hi = index(bar.low), index(bar.high)
        new_lower, new_upper = min(lower, lo), max(upper, hi)
        if new_upper - new_lower + 1 > 2000:
            raise ProfileLimitError("Profile exceeds 2000 bins; increase bin_size")
        volumes = np.pad(volumes, (lower - new_lower, new_upper - upper))
        lower, upper = new_lower, new_upper
        volumes[lo - lower:hi - lower + 1] += bar.volume / (hi - lo + 1)
        if volumes.sum() <= 0:
            continue
        poc, low, high, _ = value_area_indices(volumes, p.value_area_fraction)
        centers = np.arange(lower, upper + 1, dtype=float) * p.bin_size + p.bin_size / 2
        points.append(DevelopingPoint(timestamp=bar.timestamp, available_at=bar.available_at,
                                      poc=float(centers[poc]), vah=float(centers[high] + p.bin_size / 2),
                                      val=float(centers[low] - p.bin_size / 2)))
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
