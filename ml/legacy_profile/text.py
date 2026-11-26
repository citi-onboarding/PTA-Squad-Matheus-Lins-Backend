"""Text helpers shared by the detectors: blank cells and accent-free normalization."""

import unicodedata


def is_blank(value: str) -> bool:
    """Return True for an empty cell or a cell with only spaces."""
    return not value.strip()


def normalize_text(value: str) -> str:
    """Return the text trimmed, lowercased, without accents, and with single spaces.

    Underscores count as spaces, so the ERP's `EM_ABERTO` matches `Em aberto`.
    """
    decomposed = unicodedata.normalize("NFKD", value.replace("_", " "))
    without_accents = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(without_accents.lower().split())
