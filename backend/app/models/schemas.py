"""Modelos Pydantic de request/response da API."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.equity.engine import DEFAULT_ITERATIONS

MIN_ITERATIONS = 100
MAX_ITERATIONS = 200_000


class EquityRequest(BaseModel):
    hero: str
    villain_range: str
    board: list[str] = Field(default_factory=list)
    iterations: int = Field(default=DEFAULT_ITERATIONS, ge=MIN_ITERATIONS, le=MAX_ITERATIONS)
    seed: int | None = None


class EquityResponse(BaseModel):
    win: float
    tie: float
    lose: float
    equity: float


class TableInfo(BaseModel):
    players: int
    stacks: list[float]
    positions: list[str]
    # Cenários válidos por posição: "open" e/ou "vs_{POS}".
    scenarios: dict[str, list[str]]


class SpotsResponse(BaseModel):
    tables: list[TableInfo]


class RangeResponse(BaseModel):
    spot_id: str
    players: int
    position: str
    scenario: str
    stack_requested: float
    stack_used: float
    # Percentual e número de combos (de 1326) que dão all-in/call, ponderados pela frequência.
    range_pct: float
    combos: float
    range: dict[str, dict[str, float]]


class LookupResponse(RangeResponse):
    hand: str
    recommendation: str
    frequencies: dict[str, float]
