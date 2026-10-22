from datetime import UTC, datetime, timedelta

from app.store import Store
from app.study_jobs import StudyRefreshTimer, StudyRunner
from tests.test_alerts import series, study

UNIVERSE = [{"symbol": "AAA", "name": "AAA", "sector": "X"}]
NOW = datetime(2026, 10, 22, 12, 0, tzinfo=UTC)


def setup(tmp_path, age_days):
    store = Store(tmp_path / "r.sqlite3")
    store.initialize()
    if age_days is not None:
        store.save_study({**study(), "generated_at": (NOW - timedelta(days=age_days)).isoformat()})
    runner = StudyRunner(store, universe=UNIVERSE, daily=lambda s, f: series(n_after=0, signal_at=25))
    return store, runner, StudyRefreshTimer(store, runner)


def test_fresh_or_missing_study_is_not_refreshed(tmp_path):
    assert setup(tmp_path, 29)[2].check(NOW) is False
    other = tmp_path / "other"
    other.mkdir()
    assert setup(other, None)[2].check(NOW) is False


def test_old_study_starts_runner_at_most_three_times_per_day(tmp_path):
    store, runner, timer = setup(tmp_path, 31)
    for _ in range(StudyRefreshTimer.MAX_ATTEMPTS):
        assert timer.check(NOW) is True
        runner.wait()
        store.save_study({**study(), "generated_at": (NOW - timedelta(days=31)).isoformat()})  # keep it old
    assert timer.check(NOW) is False
    assert timer.check(NOW + timedelta(hours=25)) is True
    runner.wait()


def test_busy_runner_does_not_use_an_attempt(tmp_path):
    store, runner, timer = setup(tmp_path, 40)
    runner.start = lambda: (runner.current_status(), False)
    assert timer.check(NOW) is False
    assert store.get_meta("study_refresh_attempts") is None
