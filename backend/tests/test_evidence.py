from copy import deepcopy

import pytest

from app import auction, price_action, vsa
from app.data import ingest
from app.evidence import check
from app.features import features
from app.interpretation import interpret
from app.models import AnalyzeRequest, Parameters
from app.profiles import profile
from scripts.demo import demo_csv, demo_source
from tests.conftest import make_bar
from tests.test_engine import ascending


def candidate_bars():
    return ascending() + [make_bar(8, o=101.6, h=103, low=101.2, c=101.3, volume=5000)]


def candidate(bars, p=Parameters(trend_method="close_difference")):
    return next(o for o in vsa.detect(bars, features(bars, p), p)
                if o.concept_id == "upthrust" and o.timestamp == bars[8].timestamp)


def test_conditions_report_measured_values_and_configured_thresholds():
    bars = candidate_bars()
    p = Parameters(wick_fraction=0.5, close_extreme=0.2, trend_method="close_difference")
    found = candidate(bars, p)
    conditions = {c.id: c for c in found.conditions_met}
    assert conditions["above_prior_high"].actual == 103
    assert conditions["above_prior_high"].expected == pytest.approx(101.6)
    assert conditions["above_prior_high"].operator == ">"
    assert conditions["large_upper_wick"].actual == pytest.approx((103 - 101.6) / (103 - 101.2))
    assert conditions["large_upper_wick"].expected == 0.5
    assert conditions["lower_close"].expected == 0.2
    assert conditions["up_background"].actual == "up"
    assert all(c.met is True for c in found.conditions_met)
    with pytest.raises(StopIteration):
        candidate(bars, Parameters(wick_fraction=0.9, trend_method="close_difference"))
    assert check("missing", "Unavailable baseline", "relative_volume", None, ">=", 2).met is None
    assert check("boundary", "Inclusive boundary", "value", 2, ">=", 2).met is True
    assert check("boundary", "Strict boundary", "value", 2, ">", 2).met is False


@pytest.mark.parametrize("status, close, high, low", [
    ("confirmed", 101, 101.3, 100.8),
    ("invalidated", 103.5, 104, 101.2),
])
def test_first_resolution_has_complete_timestamps_and_causal_history(status, close, high, low):
    bars = candidate_bars()
    provisional = candidate(bars)
    assert provisional.status == "provisional"
    assert [h.status for h in provisional.status_history] == ["provisional"]
    assert provisional.resolved_at is None
    bars.append(make_bar(9, o=101.2, h=high, low=low, c=close))
    resolved = candidate(bars)
    assert resolved.status == status
    assert [h.status for h in resolved.status_history] == ["provisional", status]
    assert [h.at for h in resolved.status_history] == [bars[8].available_at, bars[9].available_at]
    assert resolved.resolved_at == getattr(resolved, f"{status}_at") == bars[9].available_at
    assert resolved.expired_at is None
    assert resolved.measurements["resolved_at"] == bars[9].available_at.isoformat()
    assert resolved.conditions_met == provisional.conditions_met
    # A subsequent reversal cannot rewrite the first outcome.
    bars.append(make_bar(10, o=102, h=105, low=100, c=104 if status == "confirmed" else 100.5))
    later = candidate(bars)
    assert later.status == resolved.status and later.status_history == resolved.status_history


def test_expiration_occurs_at_exact_horizon_without_inventing_followthrough():
    p = Parameters(confirmation_bars=2, trend_method="close_difference")
    bars = candidate_bars()
    bars += [make_bar(9, o=102, h=103, low=101.2, c=103),
             make_bar(10, o=102, h=103, low=101.2, c=101.2)]
    assert candidate(bars[:-1], p).status == "provisional"
    expired = candidate(bars, p)
    assert expired.status == "expired"
    assert expired.expired_at == expired.resolved_at == bars[-1].available_at
    assert expired.confirmed_at is None and expired.invalidated_at is None
    assert [h.status for h in expired.status_history] == ["provisional", "expired"]
    assert "follow_through_close" not in expired.measurements
    bars.append(make_bar(11, o=101, h=102, low=100, c=100.5))
    assert candidate(bars, p).status_history == expired.status_history


@pytest.mark.parametrize("next_bar", [make_bar(10, o=103, h=104, low=102, c=103.5),
                                     make_bar(0, session="2025-03-11", o=103, h=104, low=102, c=103.5)])
def test_missing_bars_and_session_boundaries_do_not_invent_resolution(next_bar):
    bars = candidate_bars() + [next_bar]
    result = candidate(bars)
    assert result.status == "provisional"
    assert result.resolved_at is None and result.expired_at is None and result.invalidated_at is None
    assert len(result.status_history) == 1


def test_each_observation_owns_its_measurements():
    bars = candidate_bars() + [make_bar(9, o=101.2, h=101.3, low=100.8, c=101)]
    p = Parameters(trend_method="close_difference")
    measured = features(bars, p)
    before = deepcopy(measured)
    results = vsa.detect(bars, measured, p)
    assert measured == before
    neutral = [o for o in results if o.timestamp == bars[8].timestamp and o.direction == "neutral"]
    assert neutral
    for o in neutral:
        assert o.status_history[0].status == "observed"
        assert len(o.status_history) == 1 and o.resolved_at is None
        assert "resolved_at" not in o.measurements and "follow_through_close" not in o.measurements


def test_price_action_and_auction_receipts_report_their_actual_rules(source):
    p = Parameters(trend_method="close_difference")
    bars = [make_bar(i, h=high) for i, high in enumerate([101, 102, 105, 103, 102])]
    pivot = next(o for o in price_action.detect(bars, features(bars, p), p) if o.concept_id == "swing_structure")
    assert pivot.conditions_met[0].actual == 105
    assert pivot.conditions_met[0].expected == 103
    assert pivot.confirmed_at == pivot.status_history[0].at == bars[-1].available_at
    assert [h.status for h in pivot.status_history] == ["confirmed"]
    prior = [make_bar(i, session="2025-03-07") for i in range(78)]
    current = [make_bar(i, o=102, h=103, low=101.5, c=102) for i in range(3)]
    profiles = [profile(prior, source, p), profile(current, source, p)]
    result = auction.classify(prior + current, profiles, {"2025-03-07"}, p)
    receipt = result.transitions[-1]
    count = next(c for c in receipt.conditions_met if c.id == "above_close_count")
    assert count.actual == 3 and count.expected == p.acceptance_bars and count.operator == ">="
    assert all(c.met is True for c in receipt.conditions_met)


def test_asof_result_excludes_later_lifecycle_entries():
    dataset, bars = ingest(demo_csv(), demo_source())
    cutoff = bars[200].available_at
    result = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, as_of=cutoff, persist=False))
    evidence = result.vsa_observations + result.price_action_observations + result.auction_state.transitions
    assert evidence
    for observation in evidence:
        assert observation.conditions_met and all(c.met is True for c in observation.conditions_met)
        assert observation.status_history
        assert observation.status_history[-1].status == observation.status
        assert all(observation.first_observable_at <= h.at <= cutoff for h in observation.status_history)
        for at in [observation.resolved_at, observation.confirmed_at, observation.invalidated_at, observation.expired_at]:
            assert at is None or at <= cutoff
