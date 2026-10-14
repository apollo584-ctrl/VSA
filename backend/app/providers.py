"""Future providers feed the same validated CSV boundary; no provider is live."""
from typing import Protocol

from app.data import ingest
from app.models import Bar, Dataset, Source


class HistoricalDataProvider(Protocol):
    def read(self) -> tuple[Source, bytes]:
        """Return declared provenance and canonical UTF-8 OHLCV CSV bytes."""
        ...


def import_provider(provider: HistoricalDataProvider) -> tuple[Dataset, list[Bar]]:
    """Never bypass CSV/session validation when adding a future adapter."""
    source, raw = provider.read()
    return ingest(raw, source)
