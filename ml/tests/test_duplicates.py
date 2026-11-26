"""Spec: Duplicate detection."""

from legacy_profile.duplicates import exact_duplicates, key_duplicates
from legacy_profile.formats import normalize_installment
from tests.conftest import text_frame


def test_exact_duplicates_are_counted() -> None:
    """Scenario: Exact duplicates are counted."""
    row = {"pedido": "1000", "produto": "P00001", "quantidade": "10"}
    frame = text_frame([row, row, row])

    assert list(exact_duplicates(frame)) == [1, 2]


def test_key_duplicates_with_different_values_are_counted() -> None:
    """Scenario: Key duplicates with different values are counted."""
    frame = text_frame(
        [
            {"pedido": "1000", "produto": "P00001", "quantidade": "10"},
            {"pedido": "1000", "produto": "P00001", "quantidade": "12"},
        ]
    )

    assert list(key_duplicates(frame, ["pedido", "produto"])) == [1]
    assert list(exact_duplicates(frame)) == []


def test_key_duplicates_with_differently_written_installments_are_counted() -> None:
    """Scenario: Key duplicates with differently written installments are counted."""
    frame = text_frame(
        [
            {"numero": "900001", "parcela": "1/3", "valor": "100,00"},
            {"numero": "900001", "parcela": "01/03", "valor": "100,00"},
            {"numero": "900001", "parcela": "2/3", "valor": "100,00"},
        ]
    )

    duplicates = key_duplicates(frame, ["numero", "parcela"], {"parcela": normalize_installment})

    assert list(duplicates) == [1]


def test_exact_duplicates_are_not_counted_again_as_key_duplicates() -> None:
    """Scenario: Exact duplicates are counted (a copy is reported once, as exact)."""
    row = {"numero": "900001", "parcela": "1/3", "valor": "100,00"}
    frame = text_frame([row, row])

    assert list(key_duplicates(frame, ["numero", "parcela"])) == []
