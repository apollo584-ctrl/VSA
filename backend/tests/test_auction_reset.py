"""Explicit auction session-reset events: distinct from transitions, causal, and absent (not invented) for legacy data."""
import json

from app import auction
from app.data import ingest
from app.interpretation import interpret
from app.models import Analysis, AnalyzeRequest, Parameters
from app.profiles import profile
from scripts.demo import demo_csv, demo_source
from tests.test_api import upload
from tests.conftest import make_bar

P = Parameters()
PRIOR = "2025-03-07"


def session(day, count, **kwargs):
    return [make_bar(i, session=day, **kwargs) for i in range(count)]


def classify(bars, complete, source):
    sessions = sorted({b.session for b in bars})
    profiles = [profile([b for b in bars if b.session == s], source, P) for s in sessions]
    return auction.classify(bars, profiles, complete, P)


def test_new_session_with_usable_prior_value_records_observable_time(source):
    prior = session(PRIOR, 78)
    current = session("2025-03-10", 2)
    result = classify(prior + current, {PRIOR}, source)
    (reset,) = result.session_resets
    assert reset.id == "auction_reset:2025-03-10" and reset.kind == "session_reset" and reset.reason == "new_session"
    assert reset.session == "2025-03-10" and reset.previous_session == PRIOR
    assert reset.timestamp == current[0].timestamp and reset.first_observable_at == current[0].available_at
    assert reset.reference_usable and reset.reference_session == PRIOR and reset.reference_unavailable_reason is None
    assert reset.previous_state == "indeterminate" and reset.state == "indeterminate"
    # The market-driven classification at the same bar stays a separate Evidence transition.
    (transition,) = result.transitions
    assert transition.id == "auction:78" and transition.timestamp == reset.timestamp and transition.id != reset.id
    assert transition.description == "indeterminate → balance" and result.evidence_ids == [transition.id]


def test_new_session_without_usable_prior_value_keeps_classification_unchanged(source):
    prior = session(PRIOR, 78)
    current = session("2025-03-10", 4, o=102, h=103, low=101.5, c=102)
    incomplete = classify(prior + current, set(), source)
    (reset,) = incomplete.session_resets
    assert not reset.reference_usable and reset.reference_session is None
    assert reset.reference_unavailable_reason == "prior_session_incomplete"
    assert incomplete.state == "indeterminate" and not incomplete.transitions
    usable = classify(prior + current, {PRIOR}, source)
    assert usable.state == "higher_price_acceptance" and usable.session_resets[0].reference_usable
    later = session("2025-03-11", 3, o=102, h=103, low=101.5, c=102)
    skipped = classify(prior + later, {PRIOR}, source)
    assert skipped.session_resets[0].reference_unavailable_reason == "prior_session_not_adjacent"
    assert skipped.state == "indeterminate"


def test_zero_volume_prior_session_has_no_value_area_reference(source):
    prior = session(PRIOR, 78, volume=0)
    current = session("2025-03-10", 4, o=102, h=103, low=101.5, c=102)
    result = classify(prior + current, {PRIOR}, source)
    (reset,) = result.session_resets
    assert reset.reference_unavailable_reason == "prior_value_area_unavailable"
    assert not reset.reference_usable and reset.reference_session is None
    assert result.state == "indeterminate" and not result.transitions


def test_reset_after_non_neutral_state_is_not_a_market_transition(source):
    first, second, third = session("2025-03-06", 78), session(PRIOR, 78, o=102, h=103, low=101.5, c=102), session("2025-03-10", 3)
    result = classify(first + second + third, {"2025-03-06", PRIOR}, source)
    assert [(r.session, r.previous_state) for r in result.session_resets] == [
        (PRIOR, "indeterminate"), ("2025-03-10", "higher_price_acceptance")]
    # The new session restarts from indeterminate: its first transition does not continue the prior acceptance.
    first_new = next(t for t in result.transitions if t.timestamp >= third[0].timestamp)
    assert first_new.description.startswith("indeterminate → ")
    reset_ids = {r.id for r in result.session_resets}
    assert not reset_ids & {t.id for t in result.transitions} and not reset_ids & set(result.evidence_ids)
    assert all(t.concept_id == "auction_state" and "→" in t.description for t in result.transitions)
    assert not any("session_reset" in t.description or "reset" in t.id for t in result.transitions)


def test_missing_bars_inside_a_session_are_not_a_session_reset(source):
    prior = session(PRIOR, 78)
    current = [make_bar(i, session="2025-03-10", o=102, h=103, low=101.5, c=102) for i in [0, 1, 3, 4]]
    result = classify(prior + current, {PRIOR}, source)
    assert len(result.session_resets) == 1 and result.session_resets[0].timestamp == current[0].timestamp


def test_replay_before_and_at_reset_observable_time():
    dataset, bars = ingest(demo_csv(), demo_source())
    first = next(b for b in bars if b.session == "2025-03-10")
    before = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, as_of=first.available_at.replace(microsecond=0) - (first.available_at - first.timestamp) / 2, persist=False))
    assert all(r.session != "2025-03-10" for r in before.auction_state.session_resets)
    at = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, as_of=first.available_at, persist=False))
    reset = at.auction_state.session_resets[-1]
    assert reset.session == "2025-03-10" and reset.first_observable_at == at.analysis_timestamp == first.available_at
    assert all(r.first_observable_at <= at.analysis_timestamp for r in at.auction_state.session_resets)
    mid = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, as_of=bars[200].available_at, persist=False))
    full = interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, persist=False))
    prefix = [r for r in full.auction_state.session_resets if r.first_observable_at <= bars[200].available_at]
    assert mid.auction_state.session_resets == prefix  # later bars never change an earlier cutoff's resets


def test_saved_snapshot_reopens_and_preview_matches(client):
    dataset = upload(client).json()
    saved = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    resets = saved["auction_state"]["session_resets"]
    assert [r["session"] for r in resets] == ["2025-03-04", "2025-03-05", "2025-03-06", "2025-03-07", "2025-03-10"]
    assert client.get(f'/api/v1/analyses/{saved["id"]}').json() == saved
    preview = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "persist": False}).json()
    assert preview["auction_state"]["session_resets"] == resets
    single = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "as_of": "2025-03-03T14:35:00Z", "persist": False}).json()
    assert single["auction_state"]["session_resets"] == []


def test_legacy_snapshot_without_resets_is_not_rewritten_or_fabricated(client):
    dataset = upload(client).json()
    result = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    legacy = dict(result, id="legacy-resets", auction_state={k: v for k, v in result["auction_state"].items() if k != "session_resets"})
    encoded = json.dumps(legacy)
    with client.app.state.store.connect() as db:
        db.execute("INSERT INTO analyses VALUES (?, ?, ?)", (legacy["id"], dataset["id"], encoded))
    reopened = client.get("/api/v1/analyses/legacy-resets").json()
    assert Analysis.model_validate(reopened).auction_state.session_resets is None
    assert reopened["auction_state"]["session_resets"] is None
    assert reopened["auction_state"]["transitions"] == result["auction_state"]["transitions"]
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT snapshot FROM analyses WHERE id=?", ("legacy-resets",)).fetchone()[0] == encoded
