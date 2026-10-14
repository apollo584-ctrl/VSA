import pytest

from app import auction, price_action, vsa
from app.data import ingest
from app.features import features
from app.interpretation import interpret
from app.knowledge import load
from app.models import AnalyzeRequest, Parameters
from app.profiles import profile
from scripts.demo import demo_csv, demo_source
from tests.conftest import csv_bytes, make_bar


def ascending():
    return [make_bar(i, o=100 + i * .2, h=100.2 + i * .2, low=99.8 + i * .2,
                     c=100.1 + i * .2, volume=1000) for i in range(8)]


def test_baselines_exclude_current_bar_and_tod_needs_history():
    bars = [make_bar(i, volume=1000) for i in range(5)] + [make_bar(5, volume=10000)]
    result = features(bars, Parameters())[-1]
    assert result["volume_ma"] == 1000 and result["relative_volume"] == 10
    assert result["tod_relative_volume"] is None
    bars = [make_bar(0, session=day, volume=v) for day, v in
            [("2025-03-03", 1000), ("2025-03-04", 1000), ("2025-03-05", 1000),
             ("2025-03-06", 1000), ("2025-03-07", 1000), ("2025-03-10", 3000)]]
    result = features(bars, Parameters())[-1]
    assert result["tod_relative_volume"] == 3
    assert result["tod_prior_sessions"] == 5


def test_contextual_upthrust_and_followthrough():
    bars = ascending()
    bars.append(make_bar(8, o=101.6, h=103, low=101.2, c=101.3, volume=5000))
    p = Parameters()
    observation = next(o for o in vsa.detect(bars, features(bars, p), p) if o.concept_id == "upthrust")
    assert observation.status == "provisional"
    assert observation.first_observable_at == bars[-1].available_at
    bars.append(make_bar(9, o=101.2, h=101.3, low=100.8, c=101, volume=2000))
    observation = next(o for o in vsa.detect(bars, features(bars, p), p) if o.concept_id == "upthrust")
    assert observation.status == "confirmed"
    assert observation.confirmed_at == bars[-1].available_at
    # Same candle without prior upward background must not acquire this contextual label.
    short = [bars[8]]
    assert not vsa.detect(short, features(short, p), p)


def test_invalidated_candidate_and_no_confirmation_across_gap():
    bars = ascending() + [make_bar(8, o=101.6, h=103, low=101.2, c=101.3, volume=5000)]
    p = Parameters()
    appended = bars + [make_bar(9, o=103, h=104, low=102, c=103.5)]
    observation = next(o for o in vsa.detect(appended, features(appended, p), p) if o.concept_id == "upthrust")
    assert observation.status == "invalidated" and observation.confirmed_at is None
    appended = bars + [make_bar(10, o=101.2, h=101.3, low=100.8, c=101)]
    observation = next(o for o in vsa.detect(appended, features(appended, p), p) if o.concept_id == "upthrust")
    assert observation.status == "provisional"


def test_pivots_are_not_backdated():
    bars = [make_bar(i, h=high) for i, high in enumerate([101, 102, 105, 103, 102])]
    p = Parameters()
    early = price_action.detect(bars[:-1], features(bars[:-1], p), p)
    assert not [o for o in early if o.concept_id == "swing_structure"]
    result = price_action.detect(bars, features(bars, p), p)
    pivot = next(o for o in result if o.concept_id == "swing_structure")
    assert pivot.timestamp == bars[2].timestamp
    assert pivot.first_observable_at == bars[4].available_at


def test_auction_transitions_and_incomplete_reference(source):
    prior = [make_bar(i, session="2025-03-07", h=101, low=99) for i in range(78)]
    current = [make_bar(i, o=102, h=103, low=101.5, c=102) for i in range(3)]
    current.append(make_bar(3, o=100, h=101, low=99, c=100))
    p = Parameters()
    profiles = [profile(prior, source, p), profile(current, source, p)]
    result = auction.classify(prior + current, profiles, {"2025-03-07"}, p)
    assert result.state == "rejection_above_value"
    assert any("higher_price_acceptance" in t.description for t in result.transitions)
    assert all(t.supporting_evidence == [profiles[0].id] for t in result.transitions)
    assert auction.classify(prior + current, profiles, set(), p).state == "indeterminate"


def test_auction_missing_session_and_gaps_cannot_establish_acceptance(source):
    p = Parameters()
    prior = [make_bar(i, session="2025-03-07") for i in range(78)]
    current = [make_bar(i, o=102, h=103, low=101.5, c=102) for i in [0, 1, 3]]
    result = auction.classify(prior + current, [profile(prior, source, p), profile(current, source, p)], {"2025-03-07"}, p)
    assert result.state == "upward_breakout_attempt"
    assert not any("→ higher_price_acceptance" in t.description for t in result.transitions)
    later = [make_bar(i, session="2025-03-11", o=102, h=103, low=101.5, c=102) for i in range(3)]
    result = auction.classify(prior + later, [profile(prior, source, p), profile(later, source, p)], {"2025-03-07"}, p)
    assert result.state == "indeterminate" and not result.transitions


def test_low_activity_context_and_expiration():
    p = Parameters(confirmation_bars=2)
    up = ascending() + [make_bar(8, o=101.5, h=101.7, low=101.5, c=101.55, volume=100)]
    assert any(o.concept_id == "no_demand" for o in vsa.detect(up, features(up, p), p))
    down = [make_bar(i, o=102 - i * .2, h=102.2 - i * .2, low=101.8 - i * .2,
                     c=101.9 - i * .2, volume=1000) for i in range(8)]
    down += [make_bar(8, o=100.5, h=100.55, low=100.35, c=100.45, volume=100)]
    assert any(o.concept_id == "no_supply" for o in vsa.detect(down, features(down, p), p))
    up += [make_bar(i, o=101.5, h=101.7, low=101.5, c=101.55) for i in [9, 10]]
    candidate = next(o for o in vsa.detect(up, features(up, p), p) if o.concept_id == "no_demand" and o.timestamp == up[8].timestamp)
    assert candidate.status == "expired"


def test_all_asof_evidence_is_observable(source):
    dataset, bars = ingest(demo_csv(), demo_source())
    as_of = bars[-2].available_at
    result = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, as_of=as_of))
    for o in result.vsa_observations + result.price_action_observations + result.auction_state.transitions:
        assert o.first_observable_at <= as_of
        assert o.confirmed_at is None or o.confirmed_at <= as_of
    assert all(profile.as_of <= as_of for profile in result.profile_analysis)


def test_asof_equals_truncated_dataset_even_after_future_split(source):
    bars = ascending() + [make_bar(8, o=101.6, h=103, low=101.2, c=101.3, volume=5000)]
    future = make_bar(9, o=50, h=51, low=49, c=50)
    full, full_bars = ingest(csv_bytes(bars + [future]), source)
    prefix, prefix_bars = ingest(csv_bytes(bars), source)
    as_of = bars[-1].available_at
    a = interpret(full, full_bars, AnalyzeRequest(dataset_id=full.id, as_of=as_of))
    b = interpret(prefix, prefix_bars, AnalyzeRequest(dataset_id=prefix.id))
    ignored = {"id", "created_at", "dataset_id"}
    assert a.model_dump(exclude=ignored) == b.model_dump(exclude=ignored)
    with pytest.raises(ValueError, match="split"):
        interpret(full, full_bars, AnalyzeRequest(dataset_id=full.id))


def test_demo_explanation_and_references_resolve():
    dataset, bars = ingest(demo_csv(), demo_source())
    result = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id))
    assert result.interpretations[0].id == "potential_weakness"
    ids = {o.id for o in result.vsa_observations + result.price_action_observations + result.auction_state.transitions}
    ids.update(profile.id for profile in result.profile_analysis)
    for scenario in result.interpretations + result.alternative_scenarios:
        assert scenario.evidence_ids and set(scenario.evidence_ids) <= ids
    concept_ids = {c.id for c in load().concepts}
    assert all(o.concept_id in concept_ids for o in result.vsa_observations + result.price_action_observations)


def test_mixed_evidence_is_retained(source):
    # An earlier upward-background upthrust is still provisional when a later
    # low is recovered in a declining background. Both hypotheses remain local.
    bars = ascending() + [make_bar(8, o=101.6, h=103.5, low=99.8, c=99.95, volume=5000)]
    bars += [make_bar(9, o=100.3, h=101, low=99.7, c=100.9, volume=5000)]
    dataset, bars = ingest(csv_bytes(bars), source)
    result = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id))
    assert result.interpretations[0].id == "mixed_evidence"
    assert result.contradicting_evidence
    directions = {o.direction for o in result.vsa_observations if o.status in ("provisional", "confirmed")}
    assert directions >= {"strength", "weakness"}


def test_no_pattern_short_history_and_zero_range(source):
    dataset, bars = ingest(csv_bytes([make_bar(0, o=100, h=100, low=100, c=100, volume=0)]), source)
    result = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id))
    assert result.interpretations[0].id == "no_significant_pattern"
    assert not result.vsa_observations
    assert any("Insufficient information" in s for s in result.uncertainties)
    assert result.auction_state.state == "indeterminate"
