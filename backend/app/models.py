import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


DataGrade = Literal["A", "B", "C"]


class Source(Model):
    instrument: str = Field(pattern=r"^[A-Z][A-Z0-9.\-]{0,15}$")
    timeframe_minutes: Literal[1, 5, 15, 30, 60, 1440] = 5
    exchange: Literal["XNYS", "CBOT"] = "XNYS"
    market: Literal["equity_xnys", "cbot_grains"] = "equity_xnys"
    contract: str | None = Field(default=None, pattern=r"^[A-Z]{1,3}[FGHJKMNQUVXZ][0-9]{2}$")
    session_mode: Literal["regular", "extended"] = "regular"
    timestamp_convention: Literal["bar_start", "bar_end"] = "bar_start"
    timezone: str = "America/New_York"
    price_adjustment: Literal["unadjusted", "split_adjusted"]
    volume_adjustment: Literal["raw", "split_adjusted"]
    source_name: str = Field(min_length=1, max_length=200)
    is_demo: bool = False

    @model_validator(mode="after")
    def compatible_adjustments(self):
        if self.market == "equity_xnys":
            if self.exchange != "XNYS":
                raise ValueError("Equity sources must use exchange XNYS")
            if self.contract is not None:
                raise ValueError("Equity sources cannot carry a futures contract")
            if self.timeframe_minutes == 1440:
                raise ValueError("Daily bars are only supported for futures sources")
        else:
            if self.exchange != "CBOT":
                raise ValueError("CBOT grain sources must use exchange CBOT")
            if self.timezone != "America/Chicago":
                raise ValueError("CBOT grain sources must use timezone America/Chicago")
            if self.contract is None:
                raise ValueError("CBOT grain sources require a contract")
            if self.instrument != self.contract:
                raise ValueError("Instrument must equal the contract code")
        if self.session_mode == "regular" and self.timeframe_minutes == 60:
            raise ValueError("60-minute bars cannot tile the 390-minute regular session; use 30 minutes or less")
        if (self.price_adjustment == "split_adjusted") != (self.volume_adjustment == "split_adjusted"):
            raise ValueError("Prices and volume must share a split-adjustment basis")
        return self


class Parameters(Model):
    bin_size: float = Field(default=0.25, ge=0.000001, le=10000)
    value_area_fraction: float = Field(default=0.7, gt=0, le=1)
    tpo_minutes: Literal[30, 60] = 30
    initial_balance_minutes: int = Field(default=60, ge=30, le=120)
    lookback: int = Field(default=20, ge=3, le=200)
    minimum_history: int = Field(default=5, ge=3, le=200)
    tod_minimum_sessions: int = Field(default=5, ge=2, le=60)
    high_volume: float = Field(default=1.8, gt=1, le=20)
    low_volume: float = Field(default=0.65, gt=0, lt=1)
    wide_spread: float = Field(default=1.5, gt=1, le=10)
    narrow_spread: float = Field(default=0.65, gt=0, lt=1)
    close_extreme: float = Field(default=0.25, gt=0, lt=0.5)
    wick_fraction: float = Field(default=0.45, gt=0, lt=1)
    confirmation_bars: int = Field(default=3, ge=1, le=20)
    pivot_bars: int = Field(default=2, ge=1, le=10)
    acceptance_bars: int = Field(default=3, ge=2, le=20)
    shape_skew: float = Field(default=0.5, gt=0, le=3)
    node_fraction: float = Field(default=0.6, gt=0, lt=1)
    valley_fraction: float = Field(default=0.35, gt=0, lt=1)
    node_separation_bins: int = Field(default=3, ge=2, le=100)
    trend_progress: float = Field(default=0.6, gt=0, lt=1)
    split_ratio: float = Field(default=1.8, gt=1, le=10)

    @model_validator(mode="after")
    def history_fits(self):
        if self.minimum_history > self.lookback:
            raise ValueError("minimum_history must not exceed lookback")
        return self


class AnalyzeRequest(Model):
    dataset_id: str
    as_of: datetime | None = None
    parameters: Parameters = Field(default_factory=Parameters)
    persist: bool = True

    @field_validator("as_of")
    @classmethod
    def aware(cls, value):
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("as_of must include a UTC offset")
        return value


class SymbolLoadRequest(Model):
    symbol: str
    timeframe_minutes: Literal[5, 15, 30] = 30
    period: Literal["5d", "1mo", "60d"] = "1mo"

    @field_validator("symbol")
    @classmethod
    def valid_symbol(cls, value):
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,15}", value):
            raise ValueError("symbol must start with a letter and use letters, digits, '.' or '-' (at most 16 characters)")
        return value


class ContractLoadRequest(Model):
    contract: str
    timeframe_minutes: Literal[5, 15, 30] = 30
    period: Literal["5d", "1mo", "60d"] = "60d"

    @field_validator("contract")
    @classmethod
    def valid_contract(cls, value):
        from app.markets import contract_parts

        value = value.strip().upper()
        contract_parts(value)  # ValueError -> 422
        return value


class Bar(Model):
    timestamp: datetime
    available_at: datetime
    session: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class Quality(Model):
    warnings: list[str]
    missing_bars: int
    absent_sessions: list[str]
    incomplete_sessions: list[str]
    split_suspected: bool = False


class Dataset(Model):
    id: str
    content_sha256: str
    source: Source
    created_at: datetime
    row_count: int
    first_timestamp: datetime
    last_available_at: datetime
    quality: Quality
    data_grade: DataGrade | None = None
    grade_basis: str | None = None
    limitations: list[str] = []


class ConditionResult(Model):
    id: str
    label: str
    metric: str
    actual: float | str | bool | None
    operator: Literal[">", ">=", "<", "<=", "==", "in"]
    expected: float | str | bool | list[str] | None
    reference: str | None = None
    met: bool | None


class StatusChange(Model):
    status: Literal["observed", "provisional", "confirmed", "invalidated", "expired"]
    at: datetime
    reason: str


# One vocabulary for "no usable prior value area", shared by session resets and value location.
# `no_prior_session` applies only to value location: a reset exists only where a prior session does.
UnusableReference = Literal["no_prior_session", "prior_session_not_adjacent", "prior_session_incomplete", "prior_value_area_unavailable"]


class ValueLocation(Model):
    """Where a close sat relative to the previous complete session's volume value area, as known at `as_of`.

    Equality rule: VAL <= price <= VAH is inside value; above is price > VAH, below is price < VAL.
    """
    state: Literal["above_value", "inside_value", "below_value", "unavailable"]
    price: float
    price_basis: Literal["bar_close"] = "bar_close"
    as_of: datetime
    reference_session: str | None = None
    val: float | None = None
    vah: float | None = None
    poc: float | None = None
    unavailable_reason: UnusableReference | None = None


class DevelopingPoint(Model):
    timestamp: datetime
    available_at: datetime
    poc: float
    vah: float
    val: float


class DevelopingProfile(Model):
    """Volume POC/VAH/VAL of the latest session as it formed; each point uses only bars closed by its `available_at`."""
    session: str
    method: Literal["volume"] = "volume"
    points: list[DevelopingPoint]


class ValueMigrationStep(Model):
    """How a session's value area relates to the previous scheduled, complete session's.

    higher_value: VAL > prior VAH. lower_value: VAH < prior VAL. Otherwise the areas overlap and the POC direction decides
    (overlapping_higher / overlapping_lower / overlapping_unchanged). `final` is false while the session is still developing.
    """
    session: str
    previous_session: str | None
    relationship: Literal["higher_value", "lower_value", "overlapping_higher", "overlapping_lower", "overlapping_unchanged"] | None
    unavailable_reason: Literal["prior_session_not_adjacent", "prior_session_incomplete", "prior_value_area_unavailable"] | None = None
    final: bool
    poc: float | None
    vah: float | None
    val: float | None
    prior_poc: float | None = None
    prior_vah: float | None = None
    prior_val: float | None = None


class Evidence(Model):
    id: str
    kind: Literal["observed", "classified"]
    concept_id: str
    timestamp: datetime
    first_observable_at: datetime
    confirmed_at: datetime | None = None
    invalidated_at: datetime | None = None
    expired_at: datetime | None = None
    resolved_at: datetime | None = None
    status_history: list[StatusChange] = Field(default_factory=list)
    conditions_met: list[ConditionResult] = Field(default_factory=list)
    status: Literal["observed", "provisional", "confirmed", "invalidated", "expired"]
    direction: Literal["strength", "weakness", "neutral"] = "neutral"
    description: str
    coordinates: dict[str, float | str | None] = Field(default_factory=dict)
    measurements: dict[str, float | str | None] = Field(default_factory=dict)
    supporting_evidence: list[str] = Field(default_factory=list)
    # Context at first_observable_at. None only for snapshots saved before value location existed.
    value_location: ValueLocation | None = None


class Shape(Model):
    classification: str
    ambiguity: Literal["low", "high"]
    features: dict[str, float]
    alternatives: list[str]
    interpretation: str
    limitations: list[str]


class Distribution(Model):
    method: str
    estimated: bool = True
    counts: list[float]
    poc: float | None
    vah: float | None
    val: float | None
    achieved_value_fraction: float | None
    shape: Shape


class Profile(Model):
    id: str
    session: str
    scope: Literal["session", "composite"]
    as_of: datetime
    bin_size: float
    price_bin_lower: list[float]
    price_bin_center: list[float]
    tpo: Distribution
    volume: Distribution
    hvns: list[float]
    lvns: list[float]
    single_print_bins: list[float]
    initial_balance: dict[str, float | str | bool | None]
    range_extension: dict[str, float | None]
    extremes: dict[str, str]
    limitations: list[str]
    data_grade: DataGrade | None = None
    grade_basis: str | None = None


class Scenario(Model):
    id: str
    kind: Literal["inferred"] = "inferred"
    description: str
    evidence_ids: list[str]
    confirmation_conditions: list[str]
    invalidation_conditions: list[str]


class SessionReset(Model):
    """A session boundary at which auction state restarts. Not a market-driven transition and not Evidence."""
    id: str
    kind: Literal["session_reset"] = "session_reset"
    reason: Literal["new_session"] = "new_session"
    session: str
    previous_session: str
    # First bar of the new session and when that bar became observable; neither is earlier than the data supports.
    timestamp: datetime
    first_observable_at: datetime
    previous_state: str
    state: Literal["indeterminate"] = "indeterminate"
    reference_session: str | None
    reference_usable: bool
    reference_unavailable_reason: UnusableReference | None = None
    description: str


class AuctionState(Model):
    state: str
    evidence_ids: list[str]
    transitions: list[Evidence]
    # None only for snapshots saved before resets were recorded; new analyses always provide a list.
    session_resets: list[SessionReset] | None = None


class Analysis(Model):
    id: str | None
    persisted: bool = True
    engine_version: str = "0.1.0"
    knowledge_version: str = "1.0.0"
    # Optional only for snapshots created before catalogs were preserved.
    knowledge_snapshot: "Knowledge | None" = None
    dataset_id: str
    instrument: str
    timeframe: str
    analysis_timestamp: datetime
    created_at: datetime
    provenance: Source
    parameters: Parameters
    data_quality: Quality
    market_context: dict[str, str | float | None]
    # Current context at the last visible bar; None only for snapshots saved before value location existed.
    value_location: ValueLocation | None = None
    # None only for snapshots saved before these existed.
    developing_profile: DevelopingProfile | None = None
    value_migration: list[ValueMigrationStep] | None = None
    profile_analysis: list[Profile]
    composite_profile: Profile | None = None
    composite_unavailable_reason: str | None = None
    vsa_observations: list[Evidence]
    price_action_observations: list[Evidence]
    auction_state: AuctionState
    supporting_evidence: list[str]
    contradicting_evidence: list[str]
    interpretations: list[Scenario]
    alternative_scenarios: list[Scenario]
    confirmation_conditions: list[str]
    invalidation_conditions: list[str]
    uncertainties: list[str]
    plain_english_summary: str
    data_grade: DataGrade | None = None
    grade_basis: str | None = None
    limitations: list[str] = []

    @model_validator(mode="after")
    def snapshot_identity(self):
        if self.persisted != (self.id is not None):
            raise ValueError("Saved analyses require an id; previews must have a null id")
        return self


class Concept(Model):
    id: str
    name: str
    category: str
    definition: str
    historical_origin_or_source: list[str]
    observable_conditions: list[str]
    required_background: list[str]
    preferred_price_location: list[str]
    volume_characteristics: list[str]
    spread_characteristics: list[str]
    close_location_characteristics: list[str]
    possible_interpretations: list[str]
    alternative_explanations: list[str]
    confirmation_conditions: list[str]
    invalidation_conditions: list[str]
    known_limitations: list[str]
    related_patterns: list[str]
    detector_status: Literal["implemented", "knowledge_only"]


class Knowledge(Model):
    version: str
    concepts: list[Concept]


Analysis.model_rebuild()


class JournalEntryIn(Model):
    """Paper-trading journal entry as sent by the client. Timestamps, id and r_multiple are set by the server."""
    trade_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    symbol: str = Field(pattern=r"^[A-Z][A-Z0-9.\-]{0,15}$")
    kind: Literal["taken", "skipped"]
    setup_version: str = Field(default="A-1.0", min_length=1, max_length=40)
    prior_vah: float | None = None
    prior_val: float | None = None
    prior_poc: float | None = None
    entry: float | None = None
    stop: float | None = None
    target: float | None = None
    shares: float | None = Field(default=None, ge=0)
    est_costs_per_share: float | None = Field(default=None, ge=0)
    planned_loss: float | None = Field(default=None, ge=0)
    exit_price: float | None = None
    exit_time: str | None = Field(default=None, max_length=40)
    exit_reason: Literal["stop", "target", "time", "other"] | None = None
    fees: float | None = Field(default=None, ge=0)
    net_pnl: float | None = None
    skip_reason: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=5000)
    rule_breach: bool = False

    @field_validator("symbol", mode="before")
    @classmethod
    def upper_symbol(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("trade_date")
    @classmethod
    def real_date(cls, value):
        datetime.strptime(value, "%Y-%m-%d")
        return value


class JournalEntry(JournalEntryIn):
    id: int
    created_at: str
    updated_at: str
    r_multiple: float | None = None
