"""Pure builder for the read-only market-structure summary (GET /api/v1/structure)."""
from datetime import date, datetime, timezone

from app import markets
from app.features import features
from app.models import Parameters, StructureLevels, StructureProfile, StructureResponse, StructureVolatility

NO_DATA = "No stored intraday data for this contract; load it with POST /api/v1/datasets/from-contract"
NO_COMPLETE_SESSION = "No complete trade date as of the requested time"
UNSUPPORTED ="Value location and auction state are not supported for intraday grain data yet"
INTRADAY = (5, 15, 30)


def pick_dataset(datasets):
    """Largest timeframe first (30, 15, 5), then the most recent bar."""
    usable = [d for d in datasets if d.source.timeframe_minutes in INTRADAY]
    if not usable:
        return None
    return max(usable, key=lambda d: (d.source.timeframe_minutes, d.last_available_at))


def _levels(distribution):
    return StructureLevels(poc=distribution.poc, vah=distribution.vah, val=distribution.val)


def _profile(p, method):
    return StructureProfile(session=p.session, bin_size=p.bin_size, value_area_method=method,
                            volume=_levels(p.volume), tpo=_levels(p.tpo), shape=p.volume.shape.classification,
                            hvns=p.hvns, lvns=p.lvns, single_print_bins=p.single_print_bins)


def build_structure(contract, root, as_of, dataset, bars, session_profiles, gate_reason, now=None):
    """dataset None -> unavailable shell. gate_reason set (or no profiles) -> profiles stay null.
    Only trade dates whose session had ended by as_of (or now) are used, for profiles and volatility alike."""
    base = {"root": root, "contract": contract, "as_of": as_of}
    incomplete_only = False
    if session_profiles:
        market = markets.get_market("cbot_grains")
        effective = as_of or now or datetime.now(timezone.utc)
        done = {p.session for p in session_profiles
                if markets.is_session_complete(date.fromisoformat(p.session), effective, market)}
        incomplete_only = not done
        session_profiles = [p for p in session_profiles if p.session in done]
        bars = [b for b in bars if b.session in done]
    if dataset is None:
        return StructureResponse(**base, limitations=[NO_DATA, UNSUPPORTED])
    limitations = list(dataset.limitations)
    shell = dict(base, dataset_id=dataset.id, data_grade=dataset.data_grade,
                 timeframe_minutes=dataset.source.timeframe_minutes)
    limitations_tail = [gate_reason] if gate_reason else []
    if incomplete_only:
        limitations_tail.append(NO_COMPLETE_SESSION)
    limitations_tail.append(UNSUPPORTED)
    if gate_reason or not session_profiles:
        return StructureResponse(**shell, limitations=limitations + limitations_tail)
    p = Parameters()
    volatility = None
    if bars:
        row = features(bars, p)[-1]
        volatility = StructureVolatility(atr=row["atr"], atr_period=p.atr_period, regime=row["volatility_regime"],
                                         trend_background=row["background"], trend_move_atr=row["trend_move_atr"])
    last = session_profiles[-1]
    prior = session_profiles[-2] if len(session_profiles) > 1 else None
    return StructureResponse(**shell, latest_session=last.session, session_profile=_profile(last, p.value_area_method),
                             prior_session_profile=_profile(prior, p.value_area_method) if prior else None,
                             volatility=volatility, limitations=limitations + limitations_tail)
