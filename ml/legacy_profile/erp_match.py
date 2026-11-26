"""Cross-check legacy codes and October 2026 receivables against the ERP export (RN-09)."""

import json
from collections.abc import Iterable
from pathlib import Path

import pandas as pd

from legacy_profile.formats import parse_date
from legacy_profile.text import is_blank

PENDING = {"status": "pending"}
OVERLAP_PERIOD = (2026, 10)  # the only month present in both the spreadsheet and the ERP


def load_erp_export(directory: Path) -> dict[str, list[dict]] | None:
    """Return the exported ERP lists by resource, or None when there is no export."""
    directory = Path(directory)
    files = sorted(directory.glob("*.json")) if directory.is_dir() else []
    if not files:
        return None
    return {file.stem: json.loads(file.read_text(encoding="utf-8")) for file in files}


def match_codes(legacy_codes: pd.Series, erp_codes: Iterable[str] | None) -> dict:
    """Count distinct legacy codes found and not found in the ERP; pending without an export."""
    if erp_codes is None:
        return dict(PENDING)
    legacy = {code for code in legacy_codes if not is_blank(code)}
    known = set(erp_codes)
    unmatched = sorted(legacy - known)
    return {
        "status": "done",
        "matched": len(legacy & known),
        "unmatched": len(unmatched),
        "unmatched_codes": unmatched,
    }


def _number_key(value: int | str) -> str:
    """Compare receivable numbers as digits, ignoring spaces and leading zeros."""
    text = str(value).strip()
    return str(int(text)) if text.isdigit() else text


def october_overlap(
    frame: pd.DataFrame,
    number_column: str,
    issue_column: str,
    erp_numbers: Iterable[int | str] | None,
) -> dict:
    """Count October 2026 receivables found in both sources or only in the spreadsheet."""
    if erp_numbers is None:
        return dict(PENDING)
    october = set()
    for number, issued in zip(frame[number_column], frame[issue_column]):
        issue_date = parse_date(issued)
        if issue_date and (issue_date.year, issue_date.month) == OVERLAP_PERIOD:
            october.add(_number_key(number))
    erp = {_number_key(number) for number in erp_numbers}
    return {"status": "done", "both": len(october & erp), "only_spreadsheet": len(october - erp)}
