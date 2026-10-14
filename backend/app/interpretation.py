"""Rule-based hypotheses tied to observation IDs; no LLM or trading signals."""
from datetime import UTC, datetime
from uuid import uuid4

from app import auction, price_action, vsa
from app.data import quality
from app.features import features
from app.models import Analysis, AnalyzeRequest, Bar, Dataset, Scenario
from app.knowledge import load
from app.profiles import profiles


def visible(bars: list[Bar], as_of):
    result = [bar for bar in bars if as_of is None or bar.available_at <= as_of]
    if not result:
        raise ValueError("No completed bars are available at as_of")
    return result


def interpret(dataset: Dataset, bars: list[Bar], request: AnalyzeRequest) -> Analysis:
    bars = visible(bars, request.as_of)
    p = request.parameters
    if p.initial_balance_minutes % dataset.source.timeframe_minutes:
        raise ValueError("Initial balance minutes must be a multiple of the bar timeframe")
    q = quality(bars, dataset.source, p)
    if q.split_suspected:
        raise ValueError("Possible split or large discontinuity: analysis blocked until a consistent dataset is supplied")
    session_profiles = profiles(bars, dataset.source, p)
    measurements = features(bars, p)
    vsa_observations = vsa.detect(bars, measurements, p)
    pa_observations = price_action.detect(bars, measurements, p)
    complete = {item.session for item in session_profiles} - set(q.incomplete_sessions)
    auction_state = auction.classify(bars, session_profiles, complete, p)
    last = session_profiles[-1]
    # Current-session evidence only. Resolve historical lifecycles, retain them in the response.
    current_ids = {bar.timestamp for bar in bars if bar.session == bars[-1].session}
    active = [o for o in vsa_observations if o.timestamp in current_ids and o.status in ("provisional", "confirmed")]
    strengths = [o.id for o in active if o.direction == "strength"]
    weaknesses = [o.id for o in active if o.direction == "weakness"]
    scenarios = []
    alternatives = []
    uncertainties = ["OHLCV cannot establish participant identity, institutional intent, aggressor flow, or exact volume-at-price.",
                     "Rule thresholds and shape ambiguity are heuristic; no predictive accuracy has been established.",
                     "Follow-through confirmation describes price behavior, not proof of an accumulation/distribution hypothesis."]
    shape_label = last.volume.shape.classification
    profile_up = shape_label in ("P_upper_heavy", "upward_elongated")
    profile_down = shape_label in ("b_lower_heavy", "downward_elongated")
    contradiction = bool(strengths and weaknesses) or bool(profile_up and weaknesses) or bool(profile_down and strengths)
    evidence = [last.id] + auction_state.evidence_ids
    if contradiction:
        ids = evidence + strengths + weaknesses
        scenarios.append(Scenario(id="mixed_evidence", description="Profile context and local strength/weakness observations are in tension; no directional conclusion is warranted.",
                                  evidence_ids=ids, confirmation_conditions=["Continued closes outside prior value, with progress rather than repeated rejection, would support acceptance."],
                                  invalidation_conditions=["Return inside prior value and failure to recover would weaken acceptance."]))
        alternatives.append(Scenario(id="temporary_rejection", description="Local rejection may be temporary profit-taking within a continuing auction, or an unsuccessful auction. OHLCV cannot distinguish motives.",
                                     evidence_ids=ids, confirmation_conditions=["Recover the rejection extreme and sustain subsequent closes beyond it."],
                                     invalidation_conditions=["Sustained closes through the opposite rejection extreme."]))
    elif strengths or weaknesses:
        direction = "strength" if strengths else "weakness"
        ids = strengths or weaknesses
        scenarios.append(Scenario(id=f"potential_{direction}", description=f"Local {direction} classifications may reflect a change in auction pressure; continuation or ordinary noise remain plausible.",
                                  evidence_ids=evidence + ids,
                                  confirmation_conditions=["Subsequent closes beyond the observation extreme in its classified direction."],
                                  invalidation_conditions=["Subsequent closes beyond its opposite extreme; lack of follow-through weakens the interpretation."]))
        alternatives.append(Scenario(id="ordinary_variation", description="The observations may be ordinary volatility or liquidity variation rather than a durable transition.",
                                     evidence_ids=ids, confirmation_conditions=["No sustained progress after the observation."],
                                     invalidation_conditions=["Repeated sustained progress outside the observation range."]))
    else:
        scenarios.append(Scenario(id="no_significant_pattern", description="No active directional VSA pattern meets the configured rules. The profile describes activity but cannot establish directional intent.",
                                  evidence_ids=evidence, confirmation_conditions=["Additional completed bars and contextual evidence are required."],
                                  invalidation_conditions=["A new context-qualified observation becomes available."]))
    if len(bars) <= p.minimum_history:
        uncertainties.append("Insufficient information for prior-only relative-volume and spread baselines.")
    if q.missing_bars:
        uncertainties.append("Incomplete data can omit context and follow-through; auction references require a complete prior session.")
    if measurements[-1]["tod_relative_volume"] is None:
        uncertainties.append("Insufficient same-slot session history for time-of-day relative volume.")
    if auction_state.state == "indeterminate":
        uncertainties.append("Auction state is indeterminate without a complete previous observed session reference.")
    state_text = "Mixed evidence" if contradiction else "Potential local strength" if strengths else "Potential local weakness" if weaknesses else "No significant directional pattern"
    summary = f"{state_text}. Estimated volume profile: {shape_label}. Auction classification: {auction_state.state}. {scenarios[0].description}"
    return Analysis(id=str(uuid4()), knowledge_version=load().version, dataset_id=dataset.id, instrument=dataset.source.instrument,
                    timeframe=f"{dataset.source.timeframe_minutes}m", analysis_timestamp=bars[-1].available_at,
                    created_at=datetime.now(UTC), provenance=dataset.source, parameters=p, data_quality=q,
                    market_context={"background": measurements[-1]["background"], "last_close": bars[-1].close,
                                    "last_session": bars[-1].session, "profile_evidence_id": last.id},
                    profile_analysis=session_profiles, vsa_observations=vsa_observations,
                    price_action_observations=pa_observations, auction_state=auction_state,
                    supporting_evidence=evidence + strengths + weaknesses,
                    contradicting_evidence=evidence + strengths + weaknesses if contradiction else [],
                    interpretations=scenarios, alternative_scenarios=alternatives,
                    confirmation_conditions=scenarios[0].confirmation_conditions,
                    invalidation_conditions=scenarios[0].invalidation_conditions, uncertainties=uncertainties,
                    plain_english_summary=summary)
