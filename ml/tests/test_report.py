"""Spec: Problem report with proposed rule, Row reconciliation, and Privacy of the published report."""

import pandas as pd
import pytest

from legacy_profile.duplicates import exact_duplicates
from legacy_profile.report import RULES, PrivacyError, build_file_report, check_privacy, render_markdown

TREATMENTS = {"correct", "discard", "pending"}


def test_each_problem_has_count_example_and_rule(orders: pd.DataFrame) -> None:
    """Scenario: Each problem has count, example, and rule."""
    report = build_file_report(
        "orders.xlsx",
        orders,
        {"exact_duplicate": exact_duplicates(orders)},
        example_columns=["pedido", "produto"],
    )

    assert len(report.problems) == 1
    problem = report.problems[0]
    assert problem["problem"] == "exact_duplicate"
    assert problem["count"] == 1
    assert problem["example"] == "row 11: pedido=1000, produto=P00001"
    assert problem["treatment"] == "discard"
    assert problem["reason"]


def test_example_row_numbers_match_the_spreadsheet(orders: pd.DataFrame) -> None:
    """Scenario: Example row numbers match the spreadsheet."""
    report = build_file_report(
        "orders.xlsx", orders, {"total_row": pd.Index([0])}, ["pedido"], header_row=4
    )

    assert report.problems[0]["example"] == "row 5: pedido=1000"


def test_every_rule_has_a_valid_treatment_and_reason() -> None:
    """Scenario: Each problem has count, example, and rule (rule table is complete)."""
    expected = {
        "exact_duplicate",
        "key_duplicate",
        "unrecognized_date",
        "unrecognized_money",
        "off_pattern_code",
        "name_reference",
        "unmatched_seller",
        "not_in_erp",
        "invalid_quantity",
        "suspicious_quantity",
        "total_row",
        "cancelled_order",
        "reversed_receivable",
        "unknown_status",
        "blank_row",
        "missing_reference",
    }
    assert set(RULES) == expected
    for treatment, reason in RULES.values():
        assert treatment in TREATMENTS
        assert reason


def test_unknown_problem_is_rejected(orders: pd.DataFrame) -> None:
    """Scenario: Each problem has count, example, and rule (no problem without a rule)."""
    with pytest.raises(KeyError):
        build_file_report("orders.xlsx", orders, {"made_up": pd.Index([0])}, ["pedido"])


def test_row_with_two_problems_is_counted_once(orders: pd.DataFrame) -> None:
    """Scenario: A row with two problems is counted once."""
    findings = {"exact_duplicate": pd.Index([9]), "invalid_quantity": pd.Index([9])}

    report = build_file_report("orders.xlsx", orders, findings, ["pedido"])

    assert report.rows_read == 10
    assert report.rows_clean == 9
    assert report.rows_with_problems == 1
    assert report.rows_read == report.rows_clean + report.rows_with_problems


def test_problems_without_rows_are_not_listed(orders: pd.DataFrame) -> None:
    """Scenario: Each problem has count, example, and rule (only problems found are listed)."""
    report = build_file_report("orders.xlsx", orders, {"total_row": pd.Index([])}, ["pedido"])

    assert report.problems == []
    assert report.rows_clean == 10


@pytest.mark.parametrize("cnpj", ["23775684000107", "23.775.684/0001-07"])
def test_example_with_a_cnpj_is_rejected(cnpj: str) -> None:
    """Scenario: Example with a CNPJ is rejected."""
    with pytest.raises(PrivacyError, match="CNPJ"):
        check_privacy(f"row 3: cliente={cnpj}")


def test_report_with_a_cnpj_in_an_example_is_not_produced() -> None:
    """Scenario: Example with a CNPJ is rejected (while building the report)."""
    frame = pd.DataFrame([{"cnpj": "23775684000107"}, {"cnpj": "23775684000107"}], dtype=str)

    with pytest.raises(PrivacyError, match="row 3"):
        build_file_report("clientes.xlsx", frame, {"exact_duplicate": pd.Index([1])}, ["cnpj"])


def test_codes_pass_the_privacy_check() -> None:
    """Scenario: Example with a CNPJ is rejected (codes and row numbers are allowed)."""
    check_privacy("row 12: cliente=C0001, produto=P00001, numero=900457")


def test_markdown_lists_problems_and_reconciliation(orders: pd.DataFrame) -> None:
    """Scenario: Each problem has count, example, and rule (rendered for the report)."""
    report = build_file_report(
        "orders.xlsx", orders, {"exact_duplicate": pd.Index([9])}, ["pedido", "produto"]
    )

    markdown = render_markdown([report])

    assert "## orders.xlsx" in markdown
    assert "| exact_duplicate | 1 | row 11: pedido=1000, produto=P00001 | discard |" in markdown
    assert "Rows read: 10 = 9 without problems + 1 with problems" in markdown
