"""Spec: Structure inventory and Format inventory."""

from datetime import date

import pandas as pd

from legacy_profile.formats import (
    classify_date,
    classify_installment,
    classify_money,
    format_counts,
    normalize_installment,
    parse_date,
    status_variants,
    structure_summary,
)
from tests.conftest import text_frame


def test_rows_columns_and_types_are_reported() -> None:
    """Scenario: Rows, columns, and types are reported."""
    frame = text_frame(
        [
            {"numero": "1", "valor": "1.234,56", "emissao": "2025-01-31"},
            {"numero": "2", "valor": "10,00", "emissao": "01/02/2025"},
            {"numero": "3", "valor": "5", "emissao": "02/02/2025"},
        ]
    )

    summary = structure_summary(frame)

    assert summary["rows"] == 3
    assert summary["columns"] == 3
    assert summary["types"] == {"numero": "integer", "valor": "decimal", "emissao": "date"}


def test_text_column_type() -> None:
    """Scenario: Rows, columns, and types are reported (free text column)."""
    frame = text_frame([{"nome": "Loja A"}, {"nome": "123"}])

    assert structure_summary(frame)["types"] == {"nome": "text"}


def test_mixed_date_formats_are_counted() -> None:
    """Scenario: Mixed date formats are counted."""
    column = pd.Series(["2025-01-31", "31/01/2025", "31/01/25", "45688", "ontem"], dtype=str)

    counts = format_counts(column, classify_date)

    assert counts == {
        "iso_date": 1,
        "day_month_year": 1,
        "day_month_short_year": 1,
        "spreadsheet_serial": 1,
        "unrecognized": 1,
    }


def test_more_date_formats_are_classified() -> None:
    """Scenario: Mixed date formats are counted (spreadsheet datetimes, dashes, blanks)."""
    assert classify_date("2025-01-31 00:00:00") == "iso_datetime"
    assert classify_date("31-01-2025") == "day_month_year_dash"
    assert classify_date("") == "empty"
    assert classify_date("31/02/2025") == "unrecognized"


def test_dates_are_parsed_from_every_recognized_format() -> None:
    """Dates are needed to find October 2026 receivables in any written format."""
    expected = date(2026, 10, 5)
    for written in ["2026-10-05", "2026-10-05 00:00:00", "05/10/2026", "05/10/26", "05-10-2026", "46300"]:
        assert parse_date(written) == expected, written
    assert parse_date("ontem") is None


def test_mixed_money_formats_are_counted() -> None:
    """Scenario: Mixed money formats are counted."""
    column = pd.Series(["R$ 1.234,56", "1.234,56", "1234.56", "1234", "abc"], dtype=str)

    counts = format_counts(column, classify_money)

    assert counts == {
        "currency_symbol": 1,
        "comma_decimal": 1,
        "dot_decimal": 1,
        "integer": 1,
        "unrecognized": 1,
    }


def test_dotted_dates_are_recognized() -> None:
    """Scenario: Dotted dates are recognized."""
    assert classify_date("08.01.2025") == "day_month_year_dot"
    assert parse_date("08.01.2025") == date(2025, 1, 8)


def test_thousands_without_cents_and_amounts_in_words_are_recognized() -> None:
    """Scenario: Thousands without cents and amounts in words are recognized."""
    column = pd.Series(["20.000", "187 mil"], dtype=str)

    assert format_counts(column, classify_money) == {"thousands_integer": 1, "amount_in_words": 1}


def test_thousands_and_words_count_as_decimal_column() -> None:
    """Scenario: Rows, columns, and types are reported (limits written in every style)."""
    frame = text_frame([{"limite": "20.000"}, {"limite": "187 mil"}, {"limite": "R$ 509.000,00"}])

    assert structure_summary(frame)["types"] == {"limite": "decimal"}


def test_installment_formats_are_counted() -> None:
    """Scenario: Installment formats are counted."""
    column = pd.Series(["1/3", "01/03", "1 de 3"], dtype=str)

    assert format_counts(column, classify_installment) == {
        "slash": 1,
        "zero_padded_slash": 1,
        "words": 1,
    }
    assert {normalize_installment(value) for value in column} == {"1/3"}


def test_unrecognized_installments_are_kept_for_review() -> None:
    """Scenario: Installment formats are counted (anything else stays as written)."""
    assert classify_installment("única") == "unrecognized"
    assert classify_installment("") == "empty"
    assert normalize_installment(" única ") == "única"


def test_status_variants_are_grouped() -> None:
    """Scenario: Status variants are grouped."""
    column = pd.Series(["Pago", " pago", "PAGO", "Em aberto"], dtype=str)

    variants = status_variants(column)

    assert set(variants) == {"pago", "em aberto"}
    assert variants["pago"] == {"Pago", " pago", "PAGO"}
    assert variants["em aberto"] == {"Em aberto"}


def test_status_accents_are_ignored_when_grouping() -> None:
    """Scenario: Status variants are grouped (accented and unaccented spellings)."""
    column = pd.Series(["Não pago", "nao  pago"], dtype=str)

    assert set(status_variants(column)) == {"nao pago"}
