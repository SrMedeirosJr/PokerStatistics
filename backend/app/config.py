"""Caminhos dos dados gerados (versionados junto com o código) e do banco local."""

from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
EQUITY_MATRIX_PATH = DATA_DIR / "equity_matrix.npz"
RANGES_DIR = DATA_DIR / "ranges"
# Tabelas de referência para stack fundo (heurística, não vêm do solver).
REFERENCE_DIR = DATA_DIR / "reference"

# Ranges personalizados do usuário (não versionado). Outro banco: POKER_DATABASE_URL.
CUSTOM_RANGES_DB = DATA_DIR / "custom_ranges.db"
DATABASE_URL_ENV = "POKER_DATABASE_URL"


def database_url() -> str:
    return os.environ.get(DATABASE_URL_ENV) or f"sqlite:///{CUSTOM_RANGES_DB.as_posix()}"
