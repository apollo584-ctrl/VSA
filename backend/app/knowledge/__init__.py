from functools import lru_cache
from importlib.resources import files

from app.models import Knowledge


@lru_cache
def load() -> Knowledge:
    result = Knowledge.model_validate_json(files(__package__).joinpath("concepts.json").read_text(encoding="utf-8"))
    ids = [c.id for c in result.concepts]
    if len(ids) != len(set(ids)):
        raise ValueError("Knowledge concept IDs must be unique")
    for concept in result.concepts:
        if set(concept.related_patterns) - set(ids):
            raise ValueError(f"Unresolved relationships in {concept.id}")
    return result
