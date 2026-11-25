"""Assemble the per-file problem report with proposed rules, reconciliation, and privacy guard."""

import re
from dataclasses import dataclass, field

import pandas as pd

# problem -> (treatment, reason). Treatments: correct, discard, or pending (RN-09, RN-16).
RULES: dict[str, tuple[str, str]] = {
    "exact_duplicate": (
        "discard",
        "Identical copy of an earlier row; keeping it would count the record twice.",
    ),
    "key_duplicate": (
        "pending",
        "Same business key with different values; the ERP or a person decides which version is right.",
    ),
    "unrecognized_date": ("pending", "Date cannot be read safely in any known format."),
    "unrecognized_money": ("pending", "Amount cannot be read safely in any known format."),
    "off_pattern_code": (
        "correct",
        "Rewrite in the ERP pattern when exactly one ERP code matches; otherwise pending.",
    ),
    "name_reference": (
        "pending",
        "Name used instead of a code; link to the ERP code only when exactly one ERP record matches.",
    ),
    "unmatched_seller": (
        "correct",
        "Nickname or variant of a seller; use the seller the ERP assigns to the customer (RN-09).",
    ),
    "not_in_erp": ("pending", "Code does not exist in the ERP, so the row cannot be linked safely."),
    "invalid_quantity": ("pending", "Quantity is not a whole number above zero; needs review."),
    "suspicious_quantity": (
        "pending",
        "Quantity above 10 times the product median; likely a typing error, needs review.",
    ),
    "total_row": ("discard", "Spreadsheet subtotal, not a record."),
    "cancelled_order": (
        "correct",
        "Keep the row marked as cancelled and exclude it from sales figures.",
    ),
    "reversed_receivable": (
        "correct",
        "Keep the receivable marked as reversed and exclude it from invoicing figures (RN-17).",
    ),
    "blank_row": ("discard", "Empty separator row with no data."),
    "missing_reference": (
        "pending",
        "Customer or product code is empty; link it to the ERP by name, description, or order"
        " only when exactly one ERP record matches, otherwise needs review.",
    ),
    "unknown_status": (
        "pending",
        "Status the ERP does not use (such as 'ok' or 'Prospect'); take the ERP status when the"
        " record exists there (RN-09), otherwise needs review.",
    ),
}

# 14 digits, with or without the 00.000.000/0000-00 mask, not part of a longer number.
CNPJ_PATTERN = re.compile(r"(?<!\d)\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}(?!\d)")


class PrivacyError(ValueError):
    """Raised when a report example would expose a CNPJ."""


@dataclass
class FileReport:
    file_name: str
    rows_read: int
    rows_clean: int
    rows_with_problems: int
    problems: list[dict] = field(default_factory=list)


def check_privacy(text: str) -> None:
    """Raise PrivacyError when the text contains a CNPJ, with or without punctuation."""
    if CNPJ_PATTERN.search(text):
        redacted = CNPJ_PATTERN.sub("[CNPJ]", text)
        raise PrivacyError(f"CNPJ found in report text: '{redacted}'")


def _example(frame: pd.DataFrame, label: int, columns: list[str], header_row: int) -> str:
    """Cite the spreadsheet row: the first record (label 0) sits right below the header."""
    cells = ", ".join(f"{column}={frame.at[label, column]}" for column in columns)
    return f"row {label + header_row + 1}: {cells}"


def build_file_report(
    file_name: str,
    frame: pd.DataFrame,
    findings: dict[str, pd.Index],
    example_columns: list[str],
    header_row: int = 1,
) -> FileReport:
    """Build the problem table and the row reconciliation for one file.

    `header_row` is the spreadsheet row holding the column names, so examples cite
    the row number a person sees in the spreadsheet.
    """
    problems = []
    rows_with_problems = pd.Index([])
    for problem, rows in findings.items():
        treatment, reason = RULES[problem]
        rows = pd.Index(rows).unique()
        if rows.empty:
            continue
        example = _example(frame, rows[0], example_columns, header_row)
        check_privacy(example)
        problems.append(
            {
                "problem": problem,
                "count": len(rows),
                "example": example,
                "treatment": treatment,
                "reason": reason,
            }
        )
        rows_with_problems = rows_with_problems.union(rows)
    flagged = len(rows_with_problems)
    return FileReport(file_name, len(frame), len(frame) - flagged, flagged, problems)


TABLE_COLUMNS = ["Problem", "Count", "Example", "Treatment", "Reason"]
PROBLEM_KEYS = ["problem", "count", "example", "treatment", "reason"]


def _table_row(cells: list) -> str:
    return "| " + " | ".join(str(cell) for cell in cells) + " |"


def render_markdown(reports: list[FileReport]) -> str:
    """Render the reports as Markdown tables, checking every line for privacy."""
    lines = []
    for report in reports:
        lines += [
            f"## {report.file_name}",
            "",
            f"Rows read: {report.rows_read} = {report.rows_clean} without problems"
            f" + {report.rows_with_problems} with problems",
            "",
        ]
        if not report.problems:
            lines += ["No problems found.", ""]
            continue
        lines += [_table_row(TABLE_COLUMNS), _table_row(["---"] * len(TABLE_COLUMNS))]
        lines += [_table_row([problem[key] for key in PROBLEM_KEYS]) for problem in report.problems]
        lines.append("")
    markdown = "\n".join(lines)
    check_privacy(markdown)
    return markdown
