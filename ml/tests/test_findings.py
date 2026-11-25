"""Spec: Row reconciliation (every problem is tied to the rows where it occurs)."""

import pandas as pd

from legacy_profile.findings import rows_classified_as, rows_not_in
from legacy_profile.formats import classify_date
from legacy_profile.references import classify_code


def test_classified_cells_are_tied_to_their_rows() -> None:
    """Scenario: Classified cells are tied to their rows."""
    column = pd.Series(["2025-01-31", "ontem", "31/01/2025"], dtype=str)

    assert list(rows_classified_as(column, classify_date, {"unrecognized"})) == [1]


def test_several_classes_can_be_selected() -> None:
    """Scenario: Classified cells are tied to their rows (more than one class at once)."""
    column = pd.Series(["C0001", "c-001", "Construtora Exemplo", ""], dtype=str)

    rows = rows_classified_as(column, lambda value: classify_code(value, "C", 4), {"off_pattern", "name"})

    assert list(rows) == [1, 2]


def test_values_missing_from_a_reference_list_are_tied_to_their_rows() -> None:
    """Scenario: Values missing from a reference list are tied to their rows."""
    column = pd.Series(["C0001", "C9999", ""], dtype=str)

    assert list(rows_not_in(column, known=["C0001"])) == [1]
