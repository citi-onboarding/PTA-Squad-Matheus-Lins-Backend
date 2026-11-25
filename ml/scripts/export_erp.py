"""Export ERP customers, products, and receivables to local JSON for the F11 cross-check.

Usage (PowerShell, from the repository root; the key is never written to disk):
    $env:ERP_API_KEY = "<team key>"
    ml/.venv/Scripts/python ml/scripts/export_erp.py

Output: ml/data/raw/erp/{clientes,produtos,titulos}.json (ignored by Git).
"""

import json
import os
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "https://pta-erp-api.onrender.com"
RESOURCES = ("clientes", "produtos", "titulos")
PAGE_SIZE = 50  # maximum page size the ERP accepts
MAX_RETRIES = 5  # waits before giving up on a page; one final attempt follows them
RETRY_STATUSES = {429, 503}  # rate limit and temporary unavailability
DEFAULT_WAIT_SECONDS = 5.0
TIMEOUT_SECONDS = 60
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "data" / "raw" / "erp"


def _retry_after(error: HTTPError) -> float:
    try:
        return float(error.headers.get("Retry-After"))
    except (TypeError, ValueError, AttributeError):
        return DEFAULT_WAIT_SECONDS


def _get_page(
    resource: str,
    page: int,
    base_url: str,
    api_key: str,
    opener: Callable,
    sleep: Callable[[float], None],
    page_size: int,
) -> dict:
    query = urlencode({"pagina": page, "tamanho": page_size})
    request = Request(
        f"{base_url}/v1/{resource}?{query}",
        headers={"X-Api-Key": api_key, "Accept": "application/json"},
    )
    for _ in range(MAX_RETRIES):
        try:
            return _read_json(request, opener)
        except HTTPError as error:
            if error.code not in RETRY_STATUSES:
                raise
            sleep(_retry_after(error))
    return _read_json(request, opener)  # last attempt: any error now propagates


def _read_json(request: Request, opener: Callable) -> dict:
    with opener(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_all(
    resource: str,
    base_url: str,
    api_key: str,
    opener: Callable,
    sleep: Callable[[float], None],
    page_size: int = PAGE_SIZE,
) -> list[dict]:
    """Return every record of a paginated ERP list, waiting on 429 and 503 responses."""
    records: list[dict] = []
    page = 1
    while True:
        body = _get_page(resource, page, base_url, api_key, opener, sleep, page_size)
        records.extend(body["dados"])
        if page >= body["totalPaginas"]:
            return records
        page += 1


def export_all(
    base_url: str,
    api_key: str,
    out_dir: Path,
    opener: Callable,
    sleep: Callable[[float], None],
) -> dict[str, int]:
    """Write one JSON file per resource and return how many records each one has."""
    out_dir.mkdir(parents=True, exist_ok=True)
    counts = {}
    for resource in RESOURCES:
        records = fetch_all(resource, base_url, api_key, opener, sleep)
        (out_dir / f"{resource}.json").write_text(
            json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        counts[resource] = len(records)
    return counts


def main(env: Mapping[str, str], out_dir: Path, opener: Callable, sleep: Callable[[float], None]) -> None:
    """Run the export with the key and base URL from the environment."""
    api_key = env.get("ERP_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("ERP_API_KEY is not set. Put the team key in the environment; never commit it.")
    base_url = env.get("ERP_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    counts = export_all(base_url, api_key, out_dir, opener, sleep)
    for resource, count in counts.items():
        print(f"{resource}: {count} records -> {out_dir / (resource + '.json')}")


if __name__ == "__main__":
    main(os.environ, OUTPUT_DIR, urlopen, time.sleep)
