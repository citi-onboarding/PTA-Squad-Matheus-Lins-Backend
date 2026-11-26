"""Spec: ERP export for the cross-check. A fake HTTP opener is used; no network access."""

import io
import json
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

import pytest

from scripts.export_erp import export_all, fetch_all, main

KEY = "test-key-not-real"
BASE = "https://erp.example"


class FakeResponse:
    def __init__(self, body: dict) -> None:
        self._body = json.dumps(body).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None


class FakeErp:
    """Serves `pages` pages per resource and records every request."""

    def __init__(self, pages: int = 3, fail_first: dict[int, tuple[int, str]] | None = None) -> None:
        self.pages = pages
        self.fail_first = dict(fail_first or {})
        self.requests: list = []

    def __call__(self, request, timeout: float = 0) -> FakeResponse:
        self.requests.append(request)
        url = urlparse(request.full_url)
        page = int(parse_qs(url.query)["pagina"][0])
        if page in self.fail_first:
            status, retry_after = self.fail_first.pop(page)
            headers = Message()
            headers["Retry-After"] = retry_after
            raise HTTPError(request.full_url, status, "error", headers, io.BytesIO(b"{}"))
        resource = url.path.rsplit("/", 1)[-1]
        records = [{"codigo": f"{resource}-{page}-{i}"} for i in range(2)]
        return FakeResponse(
            {"dados": records, "pagina": page, "tamanho": 2, "total": self.pages * 2, "totalPaginas": self.pages}
        )


def test_all_pages_are_exported() -> None:
    """Scenario: All pages are exported."""
    erp = FakeErp(pages=3)

    records = fetch_all("clientes", BASE, KEY, opener=erp, sleep=lambda s: None)

    assert len(records) == 6
    assert len({r["codigo"] for r in records}) == 6
    assert all(r.get_header("X-api-key") == KEY for r in erp.requests)
    assert "/v1/clientes" in erp.requests[0].full_url


def test_rate_limit_is_honored() -> None:
    """Scenario: Rate limit is honored."""
    erp = FakeErp(pages=3, fail_first={2: (429, "2")})
    waits: list[float] = []

    records = fetch_all("clientes", BASE, KEY, opener=erp, sleep=waits.append)

    assert waits == [2.0]
    assert len(records) == 6
    assert len({r["codigo"] for r in records}) == 6


def test_unavailable_erp_is_retried() -> None:
    """Scenario: Rate limit is honored (503 with Retry-After behaves the same)."""
    erp = FakeErp(pages=1, fail_first={1: (503, "1")})
    waits: list[float] = []

    records = fetch_all("titulos", BASE, KEY, opener=erp, sleep=waits.append)

    assert waits == [1.0]
    assert len(records) == 2


def test_missing_key_stops_the_export(tmp_path: Path) -> None:
    """Scenario: Missing key stops the export."""
    erp = FakeErp()

    with pytest.raises(SystemExit, match="ERP_API_KEY"):
        main(env={}, out_dir=tmp_path, opener=erp, sleep=lambda s: None)

    assert erp.requests == []


def test_the_key_never_reaches_the_output(tmp_path: Path) -> None:
    """Scenario: The key never reaches the output."""
    counts = export_all(BASE, KEY, tmp_path, opener=FakeErp(pages=2), sleep=lambda s: None)

    assert counts == {"clientes": 4, "produtos": 4, "titulos": 4}
    files = sorted(tmp_path.glob("*.json"))
    assert [f.name for f in files] == ["clientes.json", "produtos.json", "titulos.json"]
    for file in files:
        assert KEY not in file.read_text(encoding="utf-8")
