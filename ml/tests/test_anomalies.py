"""Spec: Suspicious rows."""

import pandas as pd

from legacy_profile.anomalies import (
    blank_rows,
    cancelled_rows,
    invalid_quantities,
    reversed_rows,
    suspicious_quantities,
    total_rows,
    unknown_statuses,
)
from tests.conftest import text_frame


def test_outlier_quantity_is_flagged() -> None:
    """Scenario: Outlier quantity is flagged."""
    quantities = ["10", "12", "8", "10", "11", "500"]
    frame = text_frame([{"produto": "P00001", "quantidade": q} for q in quantities])

    assert list(suspicious_quantities(frame, "produto", "quantidade")) == [5]


def test_products_with_few_rows_are_not_judged() -> None:
    """Scenario: Outlier quantity is flagged (needs at least 5 rows of the product)."""
    frame = text_frame([{"produto": "P00002", "quantidade": q} for q in ["1", "1", "100"]])

    assert list(suspicious_quantities(frame, "produto", "quantidade")) == []


def test_invalid_quantity_is_flagged() -> None:
    """Scenario: Invalid quantity is flagged."""
    column = pd.Series(["0", "-3", "2,5", "7", "", "abc"], dtype=str)

    assert list(invalid_quantities(column)) == [0, 1, 2, 4, 5]


def test_total_rows_are_flagged() -> None:
    """Scenario: Total rows are flagged."""
    frame = text_frame(
        [
            {"pedido": "1000", "cliente": "C0001", "produto": "P00001", "valor": "100,00"},
            {"pedido": "", "cliente": "TOTAL", "produto": "", "valor": "100,00"},
            {"pedido": "", "cliente": "", "produto": "", "valor": "250,00"},
            {"pedido": "", "cliente": "", "produto": "", "valor": ""},
            {"pedido": "1001", "cliente": "C0002", "produto": "P00002", "valor": "Total geral"},
        ]
    )

    flagged = total_rows(frame, ["pedido", "cliente", "produto"], ["valor"])

    assert list(flagged) == [1, 2, 4]


def test_blank_separator_rows_are_flagged() -> None:
    """Scenario: Blank separator rows are flagged."""
    frame = text_frame(
        [
            {"codigo": "C0001", "situacao": "Ativo"},
            {"codigo": "", "situacao": ""},
            {"codigo": "  ", "situacao": " "},
            {"codigo": "", "situacao": "Ativo"},
        ]
    )

    assert list(blank_rows(frame)) == [1, 2]


def test_cancelled_orders_are_flagged() -> None:
    """Scenario: Cancelled orders and reversed receivables are flagged."""
    column = pd.Series(["Faturado", "cancelado", "CANCELADO ", "Cancelada"], dtype=str)

    assert list(cancelled_rows(column)) == [1, 2, 3]


def test_unknown_customer_status_is_flagged() -> None:
    """Scenario: Unknown customer status is flagged."""
    column = pd.Series(["Ativo", "ok", " bloqueado", "Prospect", "INATIVO", ""], dtype=str)

    flagged = unknown_statuses(column, allowed=["ATIVO", "BLOQUEADO", "INATIVO"])

    assert list(flagged) == [1, 3]


def test_erp_statuses_with_underscores_match_spaced_spellings() -> None:
    """Scenario: ERP statuses written with underscores match spaced spellings."""
    column = pd.Series(["Em aberto", "EM ABERTO ", "Quitado"], dtype=str)

    flagged = unknown_statuses(column, allowed=["PAGO", "EM_ABERTO", "VENCIDO"])

    assert list(flagged) == [2]


def test_reversed_receivables_are_flagged() -> None:
    """Scenario: Cancelled orders and reversed receivables are flagged."""
    column = pd.Series(["Pago", "Estornado", "estornado", "Em aberto"], dtype=str)

    assert list(reversed_rows(column)) == [1, 2]
