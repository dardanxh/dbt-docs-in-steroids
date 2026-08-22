"""Unit tests for model-error identity resolution (pure logic, no DB).

Replace-per-model semantics + aggregates are exercised end-to-end via the API
in the verification step; here we cover the name/unique_id resolver directly.
"""

from __future__ import annotations

from app.domain.model_errors.services import ModelErrorsService


def _fixture() -> tuple[set[str], dict[str, list[str]]]:
    by_uid = {"model.dwh.merchant", "model.stage.merchant", "seed.dwh.country"}
    by_name = {
        "merchant": ["model.dwh.merchant", "model.stage.merchant"],  # ambiguous
        "country": ["seed.dwh.country"],  # unique
    }
    return by_uid, by_name


def test_resolves_exact_unique_id() -> None:
    by_uid, by_name = _fixture()
    assert ModelErrorsService._resolve("model.dwh.merchant", by_uid, by_name) == "model.dwh.merchant"


def test_resolves_unambiguous_name() -> None:
    by_uid, by_name = _fixture()
    assert ModelErrorsService._resolve("country", by_uid, by_name) == "seed.dwh.country"


def test_ambiguous_name_is_unresolved() -> None:
    by_uid, by_name = _fixture()
    # "merchant" maps to two unique_ids -> cannot disambiguate -> None
    assert ModelErrorsService._resolve("merchant", by_uid, by_name) is None


def test_unknown_model_is_unresolved() -> None:
    by_uid, by_name = _fixture()
    assert ModelErrorsService._resolve("does_not_exist", by_uid, by_name) is None
