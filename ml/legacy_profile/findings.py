"""Tie column-level classifications and reference checks to the rows where they occur."""

from collections.abc import Callable, Iterable

import pandas as pd

from legacy_profile.text import is_blank


def rows_where(series: pd.Series, predicate: Callable[[str], bool]) -> pd.Index:
    """Return the row labels whose cell satisfies the predicate."""
    return series.index[series.map(predicate).astype(bool)]


def rows_classified_as(
    series: pd.Series, classifier: Callable[[str], str], classes: set[str]
) -> pd.Index:
    """Return the row labels whose cell the classifier puts in one of `classes`."""
    return rows_where(series, lambda value: classifier(value) in classes)


def rows_not_in(series: pd.Series, known: Iterable[str]) -> pd.Index:
    """Return the row labels whose non-blank cell is not in `known`, such as codes missing from the ERP."""
    known_values = set(known)
    return rows_where(series, lambda value: not is_blank(value) and value not in known_values)
