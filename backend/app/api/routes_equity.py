from __future__ import annotations

from fastapi import APIRouter

from app.core.cards import parse_card, parse_hand
from app.core.range_parser import RangeParseError, parse_weighted_range
from app.equity.engine import hand_vs_range
from app.models.schemas import EquityRequest, EquityResponse

router = APIRouter(prefix="/api", tags=["equity"])


@router.post("/equity", response_model=EquityResponse)
def calculate_equity(request: EquityRequest) -> EquityResponse:
    """Equity da mão (ou classe) do herói contra um range, por Monte Carlo."""
    hero = parse_hand(request.hero)
    villain_range = parse_weighted_range(request.villain_range)
    if not villain_range:
        raise RangeParseError("Informe o range do adversário (ex.: 22+,A2s+,K9o+).")
    board = [parse_card(card) for card in request.board]

    result = hand_vs_range(hero, villain_range, board, request.iterations, request.seed)
    return EquityResponse(win=result.win, tie=result.tie, lose=result.lose, equity=result.equity)
