"""Shared synthetic fixtures. No real DistriLux data is used in tests."""

import pandas as pd
import pytest


def text_frame(rows: list[dict]) -> pd.DataFrame:
    """Build a DataFrame whose cells are all text, as the readers produce."""
    return pd.DataFrame(rows, dtype=str)


@pytest.fixture
def orders() -> pd.DataFrame:
    """Ten order rows; the last one (label 9) repeats the first one exactly."""
    rows = [
        {"pedido": str(1000 + i), "cliente": "C0001", "produto": "P00001", "quantidade": "10"}
        for i in range(9)
    ]
    rows.append({"pedido": "1000", "cliente": "C0001", "produto": "P00001", "quantidade": "10"})
    return text_frame(rows)
