"""Spec: Reference quality."""

import pandas as pd

from legacy_profile.references import (
    classify_code,
    missing_references,
    reference_counts,
    unmatched_sellers,
)
from tests.conftest import text_frame


def test_customer_references_are_classified() -> None:
    """Scenario: Customer references are classified."""
    column = pd.Series(["C0001", "c-001", "Construtora Exemplo"], dtype=str)

    counts = reference_counts(column, prefix="C", digits=4)

    assert counts == {"standard": 1, "off_pattern": 1, "name": 1}


def test_product_codes_use_five_digits() -> None:
    """Scenario: Customer references are classified (product pattern P + 5 digits)."""
    assert classify_code("P00001", prefix="P", digits=5) == "standard"
    assert classify_code("P0001", prefix="P", digits=5) == "off_pattern"
    assert classify_code("p00001", prefix="P", digits=5) == "off_pattern"
    assert classify_code(" P00001 ", prefix="P", digits=5) == "off_pattern"
    assert classify_code("00001", prefix="P", digits=5) == "off_pattern"
    assert classify_code("Cabo flexível 2,5mm", prefix="P", digits=5) == "name"
    assert classify_code("", prefix="P", digits=5) == "empty"


def test_missing_reference_is_flagged() -> None:
    """Scenario: Missing reference is flagged."""
    frame = text_frame(
        [
            {"produto": "P00001", "descricao": "Cabo flexível"},
            {"produto": "", "descricao": "Disjuntor 16A"},
            {"produto": " ", "descricao": "Tomada"},
            {"produto": "", "descricao": ""},
        ]
    )

    assert list(missing_references(frame, "produto")) == [1, 2]


def test_seller_nicknames_are_reported() -> None:
    """Scenario: Seller nicknames are reported."""
    column = pd.Series(["Patricia Lins", "Paty", "Paty", ""], dtype=str)

    unmatched = unmatched_sellers(column, erp_sellers=["Patricia Lins"])

    assert unmatched == {"Paty": 2}
