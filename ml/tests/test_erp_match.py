"""Spec: ERP cross-check."""

import json
from pathlib import Path

import pandas as pd

from legacy_profile.erp_match import load_erp_export, match_codes, october_overlap
from tests.conftest import text_frame


def test_codes_are_matched_against_the_erp() -> None:
    """Scenario: Codes are matched against the ERP."""
    legacy = pd.Series(["C0001", "C0002", "C9999", "C0001"], dtype=str)

    result = match_codes(legacy, erp_codes=["C0001", "C0002"])

    assert result["status"] == "done"
    assert result["matched"] == 2
    assert result["unmatched"] == 1
    assert result["unmatched_codes"] == ["C9999"]


def test_october_2026_receivables_overlap() -> None:
    """Scenario: October 2026 receivables overlap."""
    frame = text_frame(
        [
            {"numero": "900001", "emissao": "05/10/2026"},
            {"numero": "900002", "emissao": "2026-10-20"},
            {"numero": "800001", "emissao": "15/09/2026"},
        ]
    )

    result = october_overlap(frame, "numero", "emissao", erp_numbers=[900001, 777])

    assert result == {"status": "done", "both": 1, "only_spreadsheet": 1}


def test_cross_check_is_pending_without_erp_export(tmp_path: Path) -> None:
    """Scenario: ERP export is missing."""
    legacy = pd.Series(["C0001"], dtype=str)
    frame = text_frame([{"numero": "900001", "emissao": "05/10/2026"}])

    assert load_erp_export(tmp_path / "erp") is None
    assert match_codes(legacy, erp_codes=None) == {"status": "pending"}
    assert october_overlap(frame, "numero", "emissao", erp_numbers=None) == {"status": "pending"}


def test_erp_export_is_loaded_by_resource(tmp_path: Path) -> None:
    """Scenario: Codes are matched against the ERP (export read from disk)."""
    directory = tmp_path / "erp"
    directory.mkdir()
    (directory / "clientes.json").write_text(json.dumps([{"codigo": "C0001"}]), encoding="utf-8")

    export = load_erp_export(directory)

    assert export == {"clientes": [{"codigo": "C0001"}]}
