"""Spec: Original files are read without change."""

import hashlib
from pathlib import Path

from openpyxl import Workbook

from legacy_profile.readers import read_table


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_xlsx(path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["codigo", "valor", "obs"])
    sheet.append(["007", "1.234,56", None])
    workbook.save(path)


def make_latin1_csv(path: Path) -> None:
    content = "numero;valor;situacao\n007;1.234,56;\n008;10,00;Não pago\n"
    path.write_bytes(content.encode("latin-1"))


def test_xlsx_is_unchanged_after_profiling(tmp_path: Path) -> None:
    """Scenario: Files are unchanged after profiling."""
    path = tmp_path / "clientes.xlsx"
    make_xlsx(path)
    before = file_hash(path)

    frame = read_table(path)

    assert len(frame) == 1
    assert file_hash(path) == before


def test_csv_is_unchanged_after_profiling(tmp_path: Path) -> None:
    """Scenario: Files are unchanged after profiling."""
    path = tmp_path / "titulos.csv"
    make_latin1_csv(path)
    before = file_hash(path)

    frame = read_table(path)

    assert len(frame) == 2
    assert file_hash(path) == before


def test_xlsx_cell_text_is_preserved(tmp_path: Path) -> None:
    """Scenario: Cell text is preserved."""
    path = tmp_path / "clientes.xlsx"
    make_xlsx(path)

    frame = read_table(path)

    assert frame.loc[0, "codigo"] == "007"
    assert frame.loc[0, "valor"] == "1.234,56"
    assert frame.loc[0, "obs"] == ""


def test_header_below_title_rows(tmp_path: Path) -> None:
    """Scenario: Header below title rows."""
    path = tmp_path / "clientes.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["CADASTRO DE CLIENTES"])
    sheet.append([])
    sheet.append(["Cód.", "Situação"])
    sheet.append(["C0001", "Ativo"])
    workbook.save(path)

    frame = read_table(path, header_row=3)

    assert list(frame.columns) == ["Cód.", "Situação"]
    assert len(frame) == 1
    assert frame.loc[0, "Cód."] == "C0001"


def test_csv_cell_text_is_preserved_with_detected_delimiter_and_encoding(tmp_path: Path) -> None:
    """Scenario: Cell text is preserved (semicolon-separated, Latin-1 file)."""
    path = tmp_path / "titulos.csv"
    make_latin1_csv(path)

    frame = read_table(path)

    assert list(frame.columns) == ["numero", "valor", "situacao"]
    assert frame.loc[0, "numero"] == "007"
    assert frame.loc[0, "valor"] == "1.234,56"
    assert frame.loc[0, "situacao"] == ""
    assert frame.loc[1, "situacao"] == "Não pago"
