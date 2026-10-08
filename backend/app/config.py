"""Caminhos dos dados gerados (versionados junto com o código)."""

from __future__ import annotations

from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
EQUITY_MATRIX_PATH = DATA_DIR / "equity_matrix.npz"
RANGES_DIR = DATA_DIR / "ranges"
