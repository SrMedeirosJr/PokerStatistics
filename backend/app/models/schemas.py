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
