"""Classify customer, product, and seller references against the ERP code patterns."""

import re
from collections import Counter
from collections.abc import Iterable

import pandas as pd

from legacy_profile.anomalies import blank_rows
from legacy_profile.text import is_blank


def classify_code(value: str, prefix: str, digits: int) -> str:
    """Return 'standard', 'off_pattern', 'name', or 'empty' for a customer or product reference.

    Standard is the exact ERP pattern (C0001, P00001). Off-pattern looks like a code
    written differently (lowercase, dash, missing zeros, extra spaces). Anything else
    is a name or description used in place of a code.
    """
    if is_blank(value):
        return "empty"
    if re.fullmatch(rf"{prefix}\d{{{digits}}}", value):
        return "standard"
    letters = re.escape(prefix.upper() + prefix.lower())
    if re.fullmatch(rf"\s*[{letters}]?[\s\-_.]*\d+\s*", value):
        return "off_pattern"
    return "name"


def reference_counts(series: pd.Series, prefix: str, digits: int) -> dict[str, int]:
    """Count the references of a column by classification."""
    return dict(Counter(classify_code(value, prefix, digits) for value in series))


def missing_references(frame: pd.DataFrame, reference_column: str) -> pd.Index:
    """Return the row labels that have data but an empty reference cell; blank rows are excluded."""
    empty_reference = frame.index[frame[reference_column].map(is_blank).astype(bool)]
    return empty_reference.difference(blank_rows(frame), sort=False)


def unmatched_sellers(series: pd.Series, erp_sellers: Iterable[str]) -> dict[str, int]:
    """Count the seller values that do not exactly match a seller name known to the ERP."""
    known = set(erp_sellers)
    return dict(Counter(value for value in series if not is_blank(value) and value not in known))
