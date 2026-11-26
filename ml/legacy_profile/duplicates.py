"""Find rows repeated exactly or by business key; the first occurrence is never counted."""

from collections.abc import Callable

import pandas as pd


def exact_duplicates(frame: pd.DataFrame) -> pd.Index:
    """Return the row labels that repeat an earlier row in every column."""
    return frame.index[frame.duplicated(keep="first")]


def key_duplicates(
    frame: pd.DataFrame,
    key_columns: list[str],
    normalizers: dict[str, Callable[[str], str]] | None = None,
) -> pd.Index:
    """Return the row labels that repeat an earlier business key but are not exact duplicates.

    `normalizers` maps a key column to a function applied before comparing, so that
    differently written values of the same key (such as `1/3` and `01/03`) match.
    """
    keys = frame[key_columns].copy()
    for column, normalize in (normalizers or {}).items():
        keys[column] = keys[column].map(normalize)
    repeats_key = keys.duplicated(keep="first")
    repeats_row = frame.duplicated(keep="first")
    return frame.index[repeats_key & ~repeats_row]
