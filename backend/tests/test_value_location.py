"""Price location against the previous complete session's value area: explicit boundaries, causal, absent (not invented) for legacy data."""
import json

import pytest

from app.data import ingest
from app.interpretation import interpret
from app.models import Analysis, AnalyzeRequest, Parameters
from app.profiles import profile
from app.value_location import annotate, locate, reference_table
from scripts.demo import demo_csv, demo_source
from tests.conftest import make_bar
from tests.test_api import upload

P = Parameters()
PRIOR = "2025-03-07"


def session(day, count, **kwargs):
    return [make_bar(i, session=day, **kwargs) for i in range(count)]


def varied_prior(day=PRIOR):
    """A prior session whose value area is a proper range, not one bin."""
    bars = []
    for i in range(78):
        centre = 100 + (i % 13)
        bars.append(make_bar(i, session=day, o=centre, h=centre + 1, low=centre - 1, c=centre, volume=1000 + 50 * (i % 5)))
    return bars


def table_for(bars, complete, source):
    sessions = sorted({b.session for b in bars})
    profiles = [profile([b for b in bars if b.session == s], source, P) for s in sessions]
    return reference_table(bars, profiles, complete), {p.session: p for p in profiles}


def demo():
    dataset, bars = ingest(demo_csv(), demo_source())
    return dataset, bars


def run(dataset, bars, as_of=None):
    return interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, as_of=as_of, persist=False))


def test_boundaries_are_inside_value_and_strict_outside(source):
    prior = varied_prior()
    current = session("2025-03-10", 1)
    table, profiles = table_for(prior + current, {PRIOR}, source)
    vah, val, poc = profiles[PRIOR].volume.vah, profiles[PRIOR].volume.val, profiles[PRIOR].volume.poc
    assert val < vah

    def at(price):
        return locate(make_bar(0, session="2025-03-10", c=price), table)

    assert at(vah).state == "inside_value" and at(val).state == "inside_value"
    assert at(vah + 0.01).state == "above_value" and at(val - 0.01).state == "below_value"
    assert at((vah + val) / 2).state == "inside_value"
    loc = at(vah + 1)
    assert (loc.reference_session, loc.val, loc.vah, loc.poc, loc.price) == (PRIOR, val, vah, poc, vah + 1)
    assert loc.price_basis == "bar_close" and loc.unavailable_reason is None


@pytest.mark.parametrize("complete,days,reason", [
    (set(), ("2025-03-10",), "no_prior_session"),
    ({PRIOR}, ("2025-03-11",), "prior_session_not_adjacent"),
])
def test_unavailable_when_reference_missing(source, complete, days, reason):
    prior = varied_prior() if reason == "prior_session_not_adjacent" else []
    current = session(days[0], 2)
    table, _ = table_for(prior + current, complete, source)
    loc = locate(current[1], table)
    assert loc.state == "unavailable" and loc.unavailable_reason == reason
    assert loc.price == current[1].close and loc.as_of == current[1].available_at
    assert (loc.reference_session, loc.val, loc.vah, loc.poc) == (None, None, None, None)


def test_unavailable_when_reference_incomplete_or_without_value_area(source):
    current = session("2025-03-10", 2)
    table, _ = table_for(varied_prior() + current, set(), source)
    assert locate(current[0], table).unavailable_reason == "prior_session_incomplete"
    table, _ = table_for(session(PRIOR, 78, volume=0) + current, {PRIOR}, source)
    loc = locate(current[0], table)
    assert loc.state == "unavailable" and loc.unavailable_reason == "prior_value_area_unavailable"


def test_each_session_uses_its_own_previous_session_not_the_latest():
    dataset, bars = demo()
    result = run(dataset, bars)
    profiles = {p.session: p for p in result.profile_analysis}
    sessions = sorted(profiles)
    previous = dict(zip(sessions[1:], sessions))
    by_time = {b.available_at: b for b in bars}
    seen = set()
    for item in result.vsa_observations + result.price_action_observations + result.auction_state.transitions:
        loc, bar = item.value_location, by_time[item.first_observable_at]
        assert loc is not None and loc.as_of == item.first_observable_at and loc.price == bar.close
        if bar.session == sessions[0]:
            assert loc.state == "unavailable" and loc.unavailable_reason == "no_prior_session"
            continue
        ref = profiles[previous[bar.session]].volume
        assert (loc.reference_session, loc.val, loc.vah, loc.poc) == (previous[bar.session], ref.val, ref.vah, ref.poc)
        assert loc.state == ("above_value" if bar.close > ref.vah else "below_value" if bar.close < ref.val else "inside_value")
        seen.add(loc.reference_session)
    assert len(seen) >= 3  # several sessions, so a "latest levels everywhere" bug would be caught


def test_delayed_pivot_is_located_when_it_becomes_observable():
    dataset, bars = demo()
    result = run(dataset, bars)
    pivots = [o for o in result.price_action_observations if o.concept_id == "swing_structure"]
    assert pivots
    by_open = {b.timestamp: b for b in bars}
    by_close = {b.available_at: b for b in bars}
    delayed = 0
    for pivot in pivots:
        candidate, confirming = by_open[pivot.timestamp], by_close[pivot.first_observable_at]
        assert pivot.first_observable_at > candidate.available_at
        assert pivot.value_location.price == confirming.close and pivot.value_location.as_of == pivot.first_observable_at
        delayed += confirming.close != candidate.close
    assert delayed  # at least one pivot would be located differently if backdated to the pivot bar


def test_replay_cutoffs_match_the_full_run_and_never_see_later_levels():
    dataset, bars = demo()
    full = run(dataset, bars)
    full_by_id = {o.id: o for o in full.vsa_observations + full.price_action_observations + full.auction_state.transitions}
    first_of_day = next(i for i, b in enumerate(bars) if b.session == "2025-03-10")
    for cutoff in (bars[60], bars[first_of_day], bars[first_of_day + 5], bars[300]):
        part = run(dataset, bars, cutoff.available_at)
        assert part.value_location.as_of == cutoff.available_at and part.value_location.price == cutoff.close
        for item in part.vsa_observations + part.price_action_observations + part.auction_state.transitions:
            assert item.value_location == full_by_id[item.id].value_location
        profiles = {p.session: p for p in part.profile_analysis}
        assert all(p.as_of <= cutoff.available_at for p in profiles.values())
        if part.value_location.reference_session:
            assert part.value_location.reference_session in profiles and part.value_location.reference_session < cutoff.session
    first_bar = run(dataset, bars, bars[0].available_at)
    assert first_bar.value_location.state == "unavailable" and first_bar.value_location.unavailable_reason == "no_prior_session"


def test_current_context_matches_last_bar_and_auction_reference():
    dataset, bars = demo()
    result = run(dataset, bars)
    loc = result.value_location
    assert loc.price == bars[-1].close == result.market_context["last_close"] and loc.as_of == result.analysis_timestamp
    for transition in result.auction_state.transitions:
        coords, tloc = transition.coordinates, transition.value_location
        assert (tloc.vah, tloc.val, tloc.reference_session) == (coords["prior_vah"], coords["prior_val"], transition.measurements["reference_session"])
        if transition.description.endswith(("upward_breakout_attempt", "higher_price_acceptance")):
            assert tloc.state == "above_value"
        if transition.description.endswith(("downward_breakout_attempt", "lower_price_acceptance")):
            assert tloc.state == "below_value"


def test_annotate_leaves_unknown_times_without_location(source):
    bars = varied_prior() + session("2025-03-10", 1)
    table, _ = table_for(bars, {PRIOR}, source)
    other = demo()[1]
    from app.models import Evidence
    ev = Evidence(id="x", kind="observed", concept_id="x", timestamp=other[0].timestamp, first_observable_at=other[0].available_at,
                  status="observed", description="x")
    annotate([ev], bars, table)
    assert ev.value_location is None


def test_saved_snapshot_reopens_and_preview_matches(client):
    dataset = upload(client).json()
    saved = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    preview = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "persist": False}).json()
    assert saved["value_location"] == preview["value_location"] and saved["value_location"]["state"] != "unavailable"

    def located(body):
        return {o["id"]: o["value_location"] for key in ("vsa_observations", "price_action_observations") for o in body[key]} | \
               {o["id"]: o["value_location"] for o in body["auction_state"]["transitions"]}

    assert located(saved) == located(preview) and all(v is not None for v in located(saved).values())
    assert client.get(f'/api/v1/analyses/{saved["id"]}').json() == saved


def test_legacy_snapshot_stays_readable_without_fabricated_context(client):
    dataset = upload(client).json()
    result = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    legacy = json.loads(json.dumps(result))
    legacy["id"] = "legacy-location"
    legacy.pop("value_location")
    for group in (legacy["vsa_observations"], legacy["price_action_observations"], legacy["auction_state"]["transitions"]):
        for item in group:
            item.pop("value_location")
    encoded = json.dumps(legacy)
    with client.app.state.store.connect() as db:
        db.execute("INSERT INTO analyses VALUES (?, ?, ?)", (legacy["id"], dataset["id"], encoded))
    reopened = client.get("/api/v1/analyses/legacy-location").json()
    parsed = Analysis.model_validate(reopened)
    assert parsed.value_location is None
    assert all(o.value_location is None for o in parsed.vsa_observations + parsed.price_action_observations + parsed.auction_state.transitions)
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT snapshot FROM analyses WHERE id=?", ("legacy-location",)).fetchone()[0] == encoded
