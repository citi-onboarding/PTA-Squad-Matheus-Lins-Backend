"""Read the original legacy files as text, without converting or changing them."""

import io
from pathlib import Path

import pandas as pd

EXCEL_SUFFIXES = {".xlsx", ".xlsm"}
CSV_DELIMITERS = (";", ",", "\t", "|")


def read_table(path: Path, sheet: str | int = 0, header_row: int = 1) -> pd.DataFrame:
    """Return every cell of an .xlsx or .csv file as text; empty cells become ''.

    `header_row` is the spreadsheet row (1-based) that holds the column names;
    rows above it, such as a title block, are skipped.
    """
    path = Path(path)
    rows_above_header = header_row - 1
    if path.suffix.lower() in EXCEL_SUFFIXES:
        frame = pd.read_excel(
            path,
            sheet_name=sheet,
            header=rows_above_header,
            dtype=str,
            keep_default_na=False,
            na_filter=False,
            engine="openpyxl",
        )
    else:
        text = _decode(path.read_bytes())
        lines = text.splitlines()
        header_line = lines[rows_above_header] if len(lines) > rows_above_header else ""
        frame = pd.read_csv(
            io.StringIO(text),
            sep=_detect_delimiter(header_line),
            skiprows=rows_above_header,
            dtype=str,
            keep_default_na=False,
            na_filter=False,
        )
    return frame.fillna("")


def _decode(raw: bytes) -> str:
    """Decode as UTF-8 when possible, otherwise as Latin-1, which accepts any byte."""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def _detect_delimiter(header_line: str) -> str:
    """Pick the delimiter that appears most often in the header line."""
    return max(CSV_DELIMITERS, key=header_line.count)
