"""Pure data-grade logic for futures (and a no-op for equities). No grade "A" is ever produced."""
from dataclasses import dataclass

from .models import DataGrade

YAHOO_LIMITATION = "Data is from Yahoo: unofficial and unverified against CME"
SPECS_LIMITATION = "Contract specs unverified"


@dataclass(frozen=True)
class GradeResult:
    grade: DataGrade | None
    basis: str | None
    limitations: list[str]
    intraday_profile_allowed: bool
    reason: str | None


def grade_equity() -> GradeResult:
    return GradeResult(None, None, [], True, None)


def grade_futures(
    timeframe_minutes: int,
    within_single_contract_window: bool,
    bars_total: int,
    placeholder_bars: int,
    off_grid_prices: int,
    spec_status: str,
    extra_limitations: list[str] | None = None,
) -> GradeResult:
    limitations = [YAHOO_LIMITATION]
    if spec_status != "verified":
        limitations.append(SPECS_LIMITATION)
    limitations.extend(extra_limitations or [])

    if timeframe_minutes == 1440:
        return GradeResult("C", "daily bars", limitations, False, "Daily bars cannot support an intraday profile")

    if not within_single_contract_window:
        return GradeResult(
            None, None, limitations, False,
            "Requested window is unsupported for a single contract (possible contract roll)",
        )

    if bars_total <= 0 or placeholder_bars >= bars_total:
        return GradeResult(None, None, limitations, False, "No usable bars: every bar is a placeholder or there are none")

    basis = f"estimated from {timeframe_minutes}-minute bars"
    if placeholder_bars > 0 or off_grid_prices > 0:
        if placeholder_bars > 0:
            limitations.append(f"{placeholder_bars} placeholder bar(s) with no trading")
        if off_grid_prices > 0:
            limitations.append(f"{off_grid_prices} price(s) off the contract tick grid")
        return GradeResult("C", basis, limitations, False, "Placeholder bars or off-grid prices lower the grade")

    return GradeResult("B", basis, limitations, True, None)
