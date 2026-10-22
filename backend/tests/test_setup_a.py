from datetime import UTC, datetime

import pytest

from app import setup_a
from app.data import ingest
from app.models import Source
from app.providers import ProviderUnavailable
from tests.conftest import csv_bytes, make_bar

PRIOR, TODAY = "2025-03-10", "2025-03-11"
SOURCE = Source(instrument="TEST", price_adjustment="unadjusted", volume_adjustment="raw", source_name="test")
CYCLE = [99.5, 100.0, 100.5, 100.0, 99.8, 100.2, 100.4, 99.6]


def prior_bars():
    out = []
    for i in range(78):
        c = CYCLE[i % len(CYCLE)]
        out.append(make_bar(i, session=PRIOR, o=c, h=c + 0.5, low=c - 0.5, c=c, volume=1000 + 10 * (i % 5)))
    return out


def evaluate(bars):
    dataset, parsed = ingest(csv_bytes(bars), SOURCE)
    return setup_a.evaluate(dataset, parsed)


def levels():
    first = evaluate(prior_bars() + [make_bar(0, session=TODAY, o=99, h=99.5, low=98.5, c=99)])
    assert first["stage"] == "waiting", first
    return first["prior_vah"], first["prior_val"]


VAH, VAL = levels()
# Offsets from the prior VAH: (open, high, low, close).
PRE = (-0.5, -0.3, -0.7, -0.5)
UP = (0.3, 0.7, 0.2, 0.5)  # accepted close above VAH, low above VAH
RETEST = (0.4, 0.6, -0.1, 0.3)
DOWN = (0.1, 0.2, -0.4, -0.2)
FAR = (0.4, 0.8, 0.3, 0.6)  # closes above VAH without touching it


def build(rows):
    return [make_bar(i, session=TODAY, o=VAH + o, h=VAH + h, low=VAH + lo, c=VAH + c) for i, (o, h, lo, c) in enumerate(rows)]


def run(*specs, pre=6):
    """Today's bars: `pre` quiet bars before 10:00 (index 6 starts at 10:00), then the given offsets."""
    return evaluate(prior_bars() + build([PRE] * pre + list(specs)))


def test_value_area_is_usable():
    assert VAL < VAH - 0.3


def test_waiting_and_counting():
    assert run(DOWN)["stage"] == "waiting"
    r = run(UP, UP)
    assert (r["stage"], r["acceptance_closes"]) == ("counting", 2)
    assert r["prior_vah"] == VAH and r["prior_val"] == VAL and r["prior_poc"] is not None


def test_triggered_with_entry_stop_and_target():
    r = run(UP, UP, UP, RETEST, (0.35, 0.5, 0.3, 0.4))
    assert r["stage"] == "triggered"
    assert r["retest"]["close"] == pytest.approx(VAH + 0.3)
    assert r["stop"] == pytest.approx(VAH - 0.1 - 0.01, abs=0.006)
    entry = r["entry_reference"]
    assert entry == pytest.approx(VAH + 0.35)
    assert r["target"] == pytest.approx(entry + 2 * (entry - r["stop"]), abs=0.006)
    assert [x for x in r["no_trade_reasons"] if "contradicting" not in x] == []


def test_triggered_without_next_bar_has_no_entry_or_target():
    r = run(UP, UP, UP, RETEST)
    assert r["stage"] == "triggered" and r["entry_reference"] is None and r["target"] is None and r["stop"] is not None


def test_retest_watch_counts_down():
    r = run(UP, UP, UP, FAR, FAR)
    assert (r["stage"], r["retest_bars_left"]) == ("retest_watch", 3)


def test_cancelled_when_close_falls_to_vah_before_retest():
    assert run(UP, UP, UP, DOWN)["stage"] == "cancelled"
    # an attempt is final even if a later bar would qualify
    assert run(UP, UP, UP, DOWN, RETEST)["stage"] == "cancelled"


def test_expired_after_five_bars_without_retest():
    assert run(UP, UP, UP, FAR, FAR, FAR, FAR)["stage"] == "retest_watch"
    assert run(UP, UP, UP, FAR, FAR, FAR, FAR, FAR)["stage"] == "expired"


def test_low_at_or_below_val_is_not_a_retest():
    deep = (0.4, 0.6, VAL - VAH - 0.1, 0.3)
    assert run(UP, UP, UP, deep)["stage"] == "retest_watch"


def test_close_at_vah_resets_the_count():
    flat = (0.0, 0.2, -0.1, 0.0)
    r = run(UP, UP, flat, UP, UP)
    assert (r["stage"], r["acceptance_closes"]) == ("counting", 2)
    assert run(UP, UP, flat, UP, UP, UP)["stage"] == "retest_watch"


def test_closes_before_ten_do_not_count():
    r = evaluate(prior_bars() + build([PRE] * 3 + [UP] * 3))  # bars 3-5 are 09:45-09:55
    assert r["stage"] == "waiting" and r["acceptance_closes"] == 0
    assert any("entry window" in x for x in r["no_trade_reasons"])


def test_closes_after_three_do_not_count_and_flag_window():
    r = run(*([DOWN] * 60), UP, UP, UP, UP)  # 60 bars from 10:00 reach 15:00
    assert r["stage"] == "waiting"
    assert any("Outside the 10:00-15:00" in x for x in r["no_trade_reasons"])


def test_entry_too_far_above_retest_close():
    r = run(UP, UP, UP, RETEST, (0.9, 1.0, 0.8, 0.9))
    assert r["stage"] == "triggered"
    assert any("0.25 times" in x for x in r["no_trade_reasons"])


def test_entry_at_or_below_stop():
    r = run(UP, UP, UP, RETEST, (-0.5, -0.4, -0.6, -0.5))
    assert any("at or below the stop" in x for x in r["no_trade_reasons"]) and r["target"] is None


def test_no_lookahead_future_bars_never_change_an_earlier_result():
    base = [UP, UP, UP, RETEST]
    short = run(*base)
    longer = run(*base, (0.35, 0.5, 0.3, 0.4), DOWN, DOWN)
    for key in ("stage", "retest", "stop", "prior_vah", "prior_val", "prior_poc", "acceptance_closes"):
        assert short[key] == longer[key]
    assert short["entry_reference"] is None and longer["entry_reference"] is not None
    assert run(UP, UP, UP, FAR)["stage"] == "retest_watch"
    assert run(UP, UP, UP, FAR, RETEST)["stage"] == "triggered"


def test_early_close_day_is_not_eligible():
    prior = [make_bar(i, session="2024-12-23", o=CYCLE[i % 8], h=CYCLE[i % 8] + .5, low=CYCLE[i % 8] - .5, c=CYCLE[i % 8]) for i in range(78)]
    today = [make_bar(i, session="2024-12-24", o=100, h=101, low=99, c=100) for i in range(8)]
    r = evaluate(prior + today)
    assert r["stage"] == "not_eligible" and r["no_trade_reasons"]


def test_missing_prior_session_is_not_eligible():
    assert evaluate([make_bar(i, session=TODAY) for i in range(8)])["stage"] == "not_eligible"


def test_missing_bar_in_todays_session_is_not_eligible():
    today = [b for i, b in enumerate(build([UP] * 4)) if i != 2]
    assert evaluate(prior_bars() + today)["stage"] == "not_eligible"


def test_a_gap_after_the_decision_does_not_rewrite_it():
    rows = build([PRE] * 6 + [UP, UP, UP, RETEST, (0.35, 0.5, 0.3, 0.4), DOWN, DOWN, DOWN])
    decided = evaluate(prior_bars() + rows[:11])
    later_gap = evaluate(prior_bars() + [b for i, b in enumerate(rows) if i != 12])
    assert decided["stage"] == later_gap["stage"] == "triggered"
    assert later_gap["entry_reference"] == decided["entry_reference"] and later_gap["stop"] == decided["stop"]
    # a later bar with a huge range cannot change the prior reference or the decision
    wild = make_bar(11, session=TODAY, o=VAH, h=VAH + 900, low=max(1.0, VAH - 90), c=VAH)
    huge = evaluate(prior_bars() + rows[:11] + [wild])
    assert huge["stage"] == "triggered" and huge["prior_vah"] == decided["prior_vah"]
    # a gap before the decision still blocks it
    assert evaluate(prior_bars() + [b for i, b in enumerate(rows) if i != 7])["stage"] == "not_eligible"


def test_yesterdays_session_is_not_shown_as_today():
    dataset, parsed = ingest(csv_bytes(prior_bars() + build([PRE] * 6 + [UP, UP, UP, RETEST, (0.35, 0.5, 0.3, 0.4)])), SOURCE)
    result = setup_a.evaluate(dataset, parsed)
    assert result["stage"] == "triggered"
    next_day = datetime(2025, 3, 12, 15, 0, tzinfo=UTC)  # 11:00 New York the following session
    stale = setup_a.fresh(dict(result), parsed, next_day)
    assert stale["stage"] == "not_eligible" and stale["entry_reference"] is None and stale["stop"] is None
    same_day_late = datetime(2025, 3, 11, 18, 0, tzinfo=UTC)  # 14:00 New York, newest bar far older than 15 min
    flagged = setup_a.fresh(dict(result), parsed, same_day_late)
    assert flagged["stage"] == "triggered" and any("stale" in x for x in flagged["no_trade_reasons"])


def test_fetch_failure_gives_no_data_not_an_error():
    def down(url):
        raise ProviderUnavailable("down")
    r = setup_a.check(["AAPL", "MSFT"], down)
    assert [s["stage"] for s in r["symbols"]] == ["no_data", "no_data"] and r["as_of"]
    assert r["symbols"][0]["symbol"] == "AAPL" and r["symbols"][0]["explanation"]
