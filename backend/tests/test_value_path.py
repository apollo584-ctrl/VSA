"""Developing value path and value migration: causal, explicit relationship rules, legacy snapshots untouched."""
import json

import pytest

from app.data import ingest
from app.interpretation import interpret
from app.models import Analysis, AnalyzeRequest, Parameters
from app.profiles import profile
from app.value_path import developing_profile, relationship, value_migration
from scripts.demo import demo_csv, demo_source
from tests.conftest import make_bar
from tests.test_api import upload

P = Parameters()
PRIOR = "2025-03-07"


def session(day, count=78, **kw):
    return [make_bar(i, session=day, **kw) for i in range(count)]


def ranged(day, centre, count=78):
    return [make_bar(i, session=day, o=centre + (i % 5), h=centre + (i % 5) + 1, low=centre + (i % 5) - 1, c=centre + (i % 5), volume=1000 + i) for i in range(count)]


def demo():
    dataset, bars = ingest(demo_csv(), demo_source())
    return dataset, bars


def run(dataset, bars, as_of=None):
    return interpret(dataset, bars, AnalyzeRequest(dataset_id=dataset.id, as_of=as_of, persist=False))


def test_developing_path_matches_a_profile_of_only_the_bars_closed_so_far(source):
    bars = ranged("2025-03-10", 100, count=20)
    path = developing_profile(bars, source, P)
    assert path.session == "2025-03-10" and len(path.points) == 20
    for k in (0, 4, 19):
        expected = profile(bars[:k + 1], source, P).volume
        point = path.points[k]
        assert (point.poc, point.vah, point.val) == (expected.poc, expected.vah, expected.val)
        assert point.available_at == bars[k].available_at and point.timestamp == bars[k].timestamp


def test_developing_path_ignores_later_bars_and_finishes_at_the_session_profile():
    dataset, bars = demo()
    full = run(dataset, bars)
    last = full.developing_profile.points[-1]
    cur = full.profile_analysis[-1].volume
    assert (last.poc, last.vah, last.val) == (cur.poc, cur.vah, cur.val)
    cutoff = bars[-20]
    part = run(dataset, bars, cutoff.available_at)
    n = len(part.developing_profile.points)
    assert part.developing_profile.session == full.developing_profile.session and part.developing_profile.points == full.developing_profile.points[:n]
    assert all(point.available_at <= cutoff.available_at for point in part.developing_profile.points)


def test_zero_volume_session_has_no_developing_path(source):
    assert developing_profile(session("2025-03-10", 5, volume=0), source, P) is None


@pytest.mark.parametrize("centre,expected", [(120, "higher_value"), (80, "lower_value")])
def test_non_overlapping_value_is_higher_or_lower(source, centre, expected):
    prior, now = profile(ranged(PRIOR, 100), source, P), profile(ranged("2025-03-10", centre), source, P)
    assert relationship(now, prior) == expected


def test_overlapping_value_uses_poc_direction(source):
    prior = profile(ranged(PRIOR, 100), source, P)
    higher = profile(session("2025-03-10", 78, o=102, h=102.5, low=101.5, c=102), source, P)
    level = prior.volume.val + 0.3
    lower = profile(session("2025-03-10", 78, o=level, h=level + 0.2, low=level - 0.1, c=level), source, P)
    same = profile(ranged("2025-03-10", 100), source, P)
    assert prior.volume.val < higher.volume.val < prior.volume.vah
    assert prior.volume.val < lower.volume.vah and lower.volume.poc < prior.volume.poc
    assert relationship(higher, prior) == "overlapping_higher" and relationship(lower, prior) == "overlapping_lower"
    assert relationship(same, prior) == "overlapping_unchanged"


def test_boundary_touching_value_overlaps(source):
    prior = profile(ranged(PRIOR, 100), source, P)
    touching = profile(session("2025-03-10", 78, o=prior.volume.vah + 0.125, h=prior.volume.vah + 0.2, low=prior.volume.vah + 0.05, c=prior.volume.vah + 0.1), source, P)
    assert touching.volume.val <= prior.volume.vah
    assert relationship(touching, prior).startswith("overlapping")


def test_migration_reports_missing_or_incomplete_references(source):
    prior, now = profile(ranged(PRIOR, 100), source, P), profile(ranged("2025-03-10", 120), source, P)
    (ok,) = value_migration([prior, now], {PRIOR, "2025-03-10"})
    assert ok.relationship == "higher_value" and ok.previous_session == PRIOR and ok.final and ok.prior_vah == prior.volume.vah
    (incomplete,) = value_migration([prior, now], set())
    assert incomplete.relationship is None and incomplete.unavailable_reason == "prior_session_incomplete" and not incomplete.final
    gap = profile(ranged("2025-03-11", 120), source, P)
    (skipped,) = value_migration([prior, gap], {PRIOR})
    assert skipped.unavailable_reason == "prior_session_not_adjacent" and skipped.previous_session is None
    empty = profile(session("2025-03-10", 5, volume=0), source, P)
    (unusable,) = value_migration([prior, empty], {PRIOR})
    assert unusable.unavailable_reason == "prior_value_area_unavailable" and unusable.vah is None


def test_migration_in_analysis_has_one_step_per_later_session_and_current_is_provisional():
    dataset, bars = demo()
    result = run(dataset, bars)
    sessions = [p.session for p in result.profile_analysis]
    assert [s.session for s in result.value_migration] == sessions[1:]
    assert all(s.final for s in result.value_migration[:-1]) is True
    mid = run(dataset, bars, bars[sum(b.session == bars[0].session for b in bars) + 5].available_at)
    assert mid.value_migration[-1].final is False  # session still in progress


def test_saved_preview_equivalence_and_legacy_snapshots(client):
    dataset = upload(client).json()
    saved = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]}).json()
    preview = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"], "persist": False}).json()
    for key in ("developing_profile", "value_migration"):
        assert saved[key] == preview[key] and saved[key]
    assert client.get(f'/api/v1/analyses/{saved["id"]}').json() == saved
    legacy = {k: v for k, v in saved.items() if k not in ("developing_profile", "value_migration")} | {"id": "legacy-path"}
    encoded = json.dumps(legacy)
    with client.app.state.store.connect() as db:
        db.execute("INSERT INTO analyses VALUES (?, ?, ?)", ("legacy-path", dataset["id"], encoded))
    reopened = client.get("/api/v1/analyses/legacy-path").json()
    assert Analysis.model_validate(reopened).developing_profile is None and reopened["value_migration"] is None
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT snapshot FROM analyses WHERE id=?", ("legacy-path",)).fetchone()[0] == encoded
