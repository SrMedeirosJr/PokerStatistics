import json
import os
from collections.abc import Iterator
from typing import Any

import pytest

from app.config import DATABASE_URL_ENV, RANGES_DIR
from app.solver.equity_matrix import EquityMatrix, load_equity_matrix


@pytest.fixture(scope="session", autouse=True)
def isolated_database(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    """Os testes usam um banco temporário, nunca os ranges personalizados do usuário."""
    path = tmp_path_factory.mktemp("db") / "custom_ranges.db"
    previous = os.environ.get(DATABASE_URL_ENV)
    os.environ[DATABASE_URL_ENV] = f"sqlite:///{path.as_posix()}"
    yield
    if previous is None:
        del os.environ[DATABASE_URL_ENV]
    else:
        os.environ[DATABASE_URL_ENV] = previous


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
