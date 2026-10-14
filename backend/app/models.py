from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Source(Model):
    instrument: str = Field(pattern=r"^[A-Z][A-Z0-9.\-]{0,15}$")
    timeframe_minutes: Literal[1, 5, 15, 30, 60] = 5
    exchange: Literal["XNYS"] = "XNYS"
    session_mode: Literal["regular", "extended"] = "regular"
    timestamp_convention: Literal["bar_start", "bar_end"] = "bar_start"
    timezone: str = "America/New_York"
    price_adjustment: Literal["unadjusted", "split_adjusted"]
    volume_adjustment: Literal["raw", "split_adjusted"]
    source_name: str = Field(min_length=1, max_length=200)
    is_demo: bool = False

    @model_validator(mode="after")
    def compatible_adjustments(self):
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

    @field_validator("as_of")
    @classmethod
    def aware(cls, value):
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("as_of must include a UTC offset")
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


class Evidence(Model):
    id: str
    kind: Literal["observed", "classified"]
    concept_id: str
    timestamp: datetime
    first_observable_at: datetime
    confirmed_at: datetime | None = None
    status: Literal["observed", "provisional", "confirmed", "invalidated", "expired"]
    direction: Literal["strength", "weakness", "neutral"] = "neutral"
    description: str
    coordinates: dict[str, float | str | None] = Field(default_factory=dict)
    measurements: dict[str, float | str | None] = Field(default_factory=dict)
    supporting_evidence: list[str] = Field(default_factory=list)


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


class Scenario(Model):
    id: str
    kind: Literal["inferred"] = "inferred"
    description: str
    evidence_ids: list[str]
    confirmation_conditions: list[str]
    invalidation_conditions: list[str]


class AuctionState(Model):
    state: str
    evidence_ids: list[str]
    transitions: list[Evidence]


class Analysis(Model):
    id: str
    engine_version: str = "0.1.0"
    knowledge_version: str = "1.0.0"
    dataset_id: str
    instrument: str
    timeframe: str
    analysis_timestamp: datetime
    created_at: datetime
    provenance: Source
    parameters: Parameters
    data_quality: Quality
    market_context: dict[str, str | float | None]
    profile_analysis: list[Profile]
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
