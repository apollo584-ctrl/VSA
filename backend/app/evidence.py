"""The same evaluated comparisons drive detection and its explanatory receipt."""
import operator
from datetime import datetime

from app.models import ConditionResult, Evidence, StatusChange

COMPARISONS = {">": operator.gt, ">=": operator.ge, "<": operator.lt,
               "<=": operator.le, "==": operator.eq, "in": lambda actual, expected: actual in expected}


def check(id: str, label: str, metric: str, actual, comparison: str, expected, reference=None) -> ConditionResult:
    met = None if actual is None or expected is None else bool(COMPARISONS[comparison](actual, expected))
    return ConditionResult(id=id, label=label, metric=metric, actual=actual,
                           operator=comparison, expected=expected, reference=reference, met=met)


def initial_status(evidence: Evidence) -> Evidence:
    evidence.status_history = [StatusChange(status=evidence.status, at=evidence.first_observable_at,
                                            reason="First observable from completed bars and the required background.")]
    return evidence


def resolve(evidence: Evidence, status: str, at: datetime, reason: str):
    if status not in {"confirmed", "invalidated", "expired"} or evidence.status != "provisional":
        raise ValueError("Only provisional observations can receive a terminal resolution")
    if at <= evidence.first_observable_at:
        raise ValueError("Resolution must follow first observability")
    evidence.status = status
    evidence.resolved_at = at
    if status == "confirmed":
        evidence.confirmed_at = at
    elif status == "invalidated":
        evidence.invalidated_at = at
    elif status == "expired":
        evidence.expired_at = at
    evidence.status_history.append(StatusChange(status=status, at=at, reason=reason))
    # Keep the original scalar field for existing consumers.
    evidence.measurements["resolved_at"] = at.isoformat()
