"""Flag suspicious rows: bad quantities, total rows, cancelled orders, and reversed receivables."""

import re
from collections.abc import Iterable

import pandas as pd

from legacy_profile.findings import rows_where
from legacy_profile.text import is_blank, normalize_text

SUSPICIOUS_FACTOR = 10
MIN_ROWS_PER_PRODUCT = 5
TOTAL_WORD = re.compile(r"\btotal\b", re.IGNORECASE)


def _is_valid_quantity(value: str) -> bool:
    text = value.strip()
    return bool(re.fullmatch(r"\d+", text)) and int(text) > 0


def _says_total(value: str) -> bool:
    return bool(TOTAL_WORD.search(value))


def invalid_quantities(series: pd.Series) -> pd.Index:
    """Return the row labels whose quantity is not a whole number above zero."""
    return rows_where(series, lambda value: not _is_valid_quantity(value))


def suspicious_quantities(
    frame: pd.DataFrame,
    product_column: str,
    quantity_column: str,
    factor: int = SUSPICIOUS_FACTOR,
    min_rows: int = MIN_ROWS_PER_PRODUCT,
) -> pd.Index:
    """Return the row labels whose quantity is above `factor` times the product median.

    Only valid quantities are used, and only products with at least `min_rows`
    valid rows are judged, so a rare product is not flagged by chance.
    """
    valid = frame.loc[rows_where(frame[quantity_column], _is_valid_quantity)]
    quantity = valid[quantity_column].str.strip().astype(int)
    product = valid[product_column]
    stats = quantity.groupby(product).agg(["median", "count"])
    medians = stats.loc[stats["count"] >= min_rows, "median"]
    product_median = product.map(medians)
    flagged = (quantity > factor * product_median).fillna(False).astype(bool)
    return valid.index[flagged]


def total_rows(
    frame: pd.DataFrame, reference_columns: list[str], amount_columns: list[str]
) -> pd.Index:
    """Return the row labels that are spreadsheet totals instead of real records.

    A total row has the word "total" in any cell, or has an amount but no order,
    customer, or product reference.
    """
    says_total = frame.map(_says_total).any(axis=1)
    no_reference = frame[reference_columns].map(is_blank).all(axis=1)
    has_amount = ~frame[amount_columns].map(is_blank).all(axis=1)
    return frame.index[says_total | (no_reference & has_amount)]


def blank_rows(frame: pd.DataFrame) -> pd.Index:
    """Return the row labels whose cells are all empty, such as separator rows."""
    return frame.index[frame.map(is_blank).all(axis=1)]


def cancelled_rows(series: pd.Series) -> pd.Index:
    """Return the row labels whose order status means cancelled."""
    return rows_where(series, lambda value: "cancel" in normalize_text(value))


def reversed_rows(series: pd.Series) -> pd.Index:
    """Return the row labels whose receivable status means reversed."""
    return rows_where(series, lambda value: "estorn" in normalize_text(value))


def unknown_statuses(series: pd.Series, allowed: Iterable[str]) -> pd.Index:
    """Return the row labels whose status is not one of the ERP statuses for that record type."""
    known = {normalize_text(status) for status in allowed}
    return rows_where(
        series, lambda value: not is_blank(value) and normalize_text(value) not in known
    )
