import json
from typing import Any

import pytest

from app.config import RANGES_DIR
from app.solver.equity_matrix import EquityMatrix, load_equity_matrix


@pytest.fixture(scope="session")
def equity_matrix() -> EquityMatrix:
    """A matriz versionada em data/equity_matrix.npz."""
    return load_equity_matrix()


@pytest.fixture(scope="session")
def range_documents() -> dict[tuple[int, float], dict[str, Any]]:
    """Todos os JSONs versionados em data/ranges, por (jogadores, stack)."""
    documents: dict[tuple[int, float], dict[str, Any]] = {}
    for path in sorted(RANGES_DIR.glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        meta = document["meta"]
        documents[(meta["players"], float(meta["stack_bb"]))] = document
    return documents
