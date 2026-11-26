"""Classify how dates, money values, and statuses were written in the legacy files."""

import re
from collections import Counter
from collections.abc import Callable
from datetime import date, datetime, timedelta

import pandas as pd

from legacy_profile.text import is_blank, normalize_text

# (format name, full-match pattern, strptime format), tested in this order.
DATE_PATTERNS = (
    ("iso_datetime", r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?", "%Y-%m-%d"),
    ("iso_date", r"\d{4}-\d{2}-\d{2}", "%Y-%m-%d"),
    ("day_month_year", r"\d{1,2}/\d{1,2}/\d{4}", "%d/%m/%Y"),
    ("day_month_short_year", r"\d{1,2}/\d{1,2}/\d{2}", "%d/%m/%y"),
    ("day_month_year_dash", r"\d{1,2}-\d{1,2}-\d{4}", "%d-%m-%Y"),
    ("day_month_year_dot", r"\d{1,2}\.\d{1,2}\.\d{4}", "%d.%m.%Y"),
)
# Spreadsheet serial dates: days since 1899-12-30; 30000..60000 covers 1982..2064.
SERIAL_RANGE = (30000, 60000)
SERIAL_EPOCH = date(1899, 12, 30)

MONEY_PATTERNS = (
    ("currency_symbol", r"-?R\$\s*-?[\d.,]+"),
    ("comma_decimal", r"-?\d{1,3}(\.\d{3})+,\d{1,2}|-?\d+,\d{1,2}"),
    ("dot_decimal", r"-?\d{1,3}(,\d{3})+\.\d{1,2}|-?\d+\.\d{1,2}"),
    ("thousands_integer", r"-?\d{1,3}(\.\d{3})+"),  # 20.000
    ("amount_in_words", r"-?\d+([.,]\d+)?\s*mil"),  # 187 mil
    ("integer", r"-?\d+"),
)
NUMERIC_MONEY_FORMATS = {name for name, _ in MONEY_PATTERNS}

INSTALLMENT_SLASH = re.compile(r"(\d+)\s*/\s*(\d+)")
INSTALLMENT_WORDS = re.compile(r"(\d+)\s+de\s+(\d+)", re.IGNORECASE)


def _match_date(value: str) -> tuple[str, date | None]:
    """Return (format name, parsed date) so classify_date and parse_date never disagree."""
    if is_blank(value):
        return "empty", None
    text = value.strip()
    for name, pattern, strptime_format in DATE_PATTERNS:
        if re.fullmatch(pattern, text):
            core = text[:10] if name == "iso_datetime" else text
            try:
                return name, datetime.strptime(core, strptime_format).date()
            except ValueError:  # matches the shape but is not a real date, e.g. 31/02
                return "unrecognized", None
    if re.fullmatch(r"\d{5}", text) and SERIAL_RANGE[0] <= int(text) <= SERIAL_RANGE[1]:
        return "spreadsheet_serial", SERIAL_EPOCH + timedelta(days=int(text))
    return "unrecognized", None


def classify_date(value: str) -> str:
    """Return the date format of a cell, such as 'iso_date' or 'unrecognized'."""
    return _match_date(value)[0]


def parse_date(value: str) -> date | None:
    """Return the date written in a cell in any recognized format, or None."""
    return _match_date(value)[1]


def classify_money(value: str) -> str:
    """Return the money format of a cell, such as 'comma_decimal' or 'unrecognized'."""
    if is_blank(value):
        return "empty"
    for name, pattern in MONEY_PATTERNS:
        if re.fullmatch(pattern, value.strip()):
            return name
    return "unrecognized"


def _match_installment(value: str) -> tuple[str, str | None]:
    """Return (format name, 'n/m') so classify and normalize never disagree."""
    if is_blank(value):
        return "empty", None
    text = value.strip()
    if slash := INSTALLMENT_SLASH.fullmatch(text):
        number, total = slash.groups()
        padded = number.startswith("0") or total.startswith("0")
        return ("zero_padded_slash" if padded else "slash"), f"{int(number)}/{int(total)}"
    if words := INSTALLMENT_WORDS.fullmatch(text):
        number, total = words.groups()
        return "words", f"{int(number)}/{int(total)}"
    return "unrecognized", None


def classify_installment(value: str) -> str:
    """Return 'slash', 'zero_padded_slash', 'words', 'empty', or 'unrecognized'."""
    return _match_installment(value)[0]


def normalize_installment(value: str) -> str:
    """Return the installment as 'n/m' for comparison, or the trimmed text when unrecognized."""
    return _match_installment(value)[1] or value.strip()


def format_counts(series: pd.Series, classifier: Callable[[str], str]) -> dict[str, int]:
    """Count how many cells of a column fall in each format returned by the classifier."""
    return dict(Counter(classifier(value) for value in series))


def status_variants(series: pd.Series) -> dict[str, set[str]]:
    """Group the written variants of each status by its normalized form."""
    variants: dict[str, set[str]] = {}
    for value in series:
        if not is_blank(value):
            variants.setdefault(normalize_text(value), set()).add(value)
    return variants


def infer_column_type(series: pd.Series) -> str:
    """Return 'integer', 'decimal', 'date', or 'text' for a column read as text."""
    values = [value for value in series if not is_blank(value)]
    if not values:
        return "text"
    if all(re.fullmatch(r"-?\d+", value.strip()) for value in values):
        return "integer"
    if all(classify_money(value) in NUMERIC_MONEY_FORMATS for value in values):
        return "decimal"
    if all(classify_date(value) not in {"empty", "unrecognized"} for value in values):
        return "date"
    return "text"


def structure_summary(frame: pd.DataFrame) -> dict:
    """Return the number of rows and columns and the inferred type of each column."""
    return {
        "rows": len(frame),
        "columns": len(frame.columns),
        "types": {column: infer_column_type(frame[column]) for column in frame.columns},
    }
