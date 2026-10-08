"""Modelos Pydantic de request/response da API."""

from __future__ import annotations

from datetime import datetime

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


class CustomSpotInfo(BaseModel):
    id: int
    name: str
    stack: float
    position: str
    scenario: str


class TableInfo(BaseModel):
    players: int
    # Stacks com ranges do solver, de referência e/ou personalizados.
    stacks: list[float]
    # Os que vêm das tabelas de referência (heurística de stack fundo).
    reference_stacks: list[float] = Field(default_factory=list)
    positions: list[str]
    # Cenários válidos por posição: "open" e/ou "vs_{POS}".
    scenarios: dict[str, list[str]]
    custom_spots: list[CustomSpotInfo] = Field(default_factory=list)


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
    # "solver" (push/fold calculado), "reference" (heurística de stack fundo) ou
    # "custom" (salvo pelo usuário, com id e nome).
    source: str = "solver"
    custom_id: int | None = None
    name: str | None = None
    # Tamanho sugerido de cada aposta, em bb (só nas tabelas de referência).
    sizes: dict[str, float] = Field(default_factory=dict)


class LookupResponse(RangeResponse):
    hand: str
    recommendation: str
    frequencies: dict[str, float]


class ParseRangeRequest(BaseModel):
    text: str


class ParseRangeResponse(BaseModel):
    # Classe de mão -> peso (0..1).
    hands: dict[str, float]
    combos: float


class CustomRangeIn(BaseModel):
    name: str = ""
    players: int
    stack_bb: float
    position: str
    scenario: str
    # Classe de mão -> {ação: frequência}. Mãos ausentes são fold.
    actions: dict[str, dict[str, float]]


class CustomRangeOut(CustomRangeIn):
    id: int
    spot_id: str
    range_pct: float
    combos: float
    updated_at: datetime


class CustomRangesDocument(BaseModel):
    format: str
    version: int
    exported_at: datetime | None = None
    ranges: list[CustomRangeIn]


class ImportResult(BaseModel):
    created: int
    updated: int
