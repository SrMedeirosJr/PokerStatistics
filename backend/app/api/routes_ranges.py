from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import CustomRanges, Store
from app.core.cards import COMBO_COUNT, normalize_hand
from app.core.errors import UserInputError
from app.core.range_parser import parse_weighted_range
from app.models.schemas import (
    LookupResponse,
    ParseRangeRequest,
    ParseRangeResponse,
    RangeResponse,
    SpotsResponse,
)
from app.services.range_store import SpotRange, recommend
from app.services.spots import resolve_spot, table_summaries

router = APIRouter(prefix="/api", tags=["ranges"])

PositiveFloat = Annotated[float | None, Query(gt=0)]


@dataclass(frozen=True)
class SpotQuery:
    players: int
    position: str
    scenario: str
    stack: float


def spot_query(
    players: int,
    position: str,
    scenario: str,
    stack: PositiveFloat = None,
    chips: PositiveFloat = None,
    big_blind: PositiveFloat = None,
) -> SpotQuery:
    """Parâmetros comuns de um spot; o stack pode vir em bb ou como fichas + valor do BB."""
    if stack is None:
        if chips is None or big_blind is None:
            raise UserInputError(
                "Informe o stack em big blinds ('stack') ou em fichas ('chips' e 'big_blind')."
            )
        stack = chips / big_blind
    return SpotQuery(players=players, position=position, scenario=scenario, stack=stack)


Spot = Annotated[SpotQuery, Depends(spot_query)]


def _range_fields(spot: SpotRange) -> dict[str, object]:
    return {
        "spot_id": spot.spot_id,
        "players": spot.players,
        "position": spot.position,
        "scenario": spot.scenario,
        "stack_requested": spot.stack_requested,
        "stack_used": spot.stack_used,
        "range_pct": spot.range_pct,
        "combos": spot.combos,
        "range": spot.actions,
        "source": spot.source,
        "custom_id": spot.custom_id,
        "name": spot.name,
    }


@router.get("/spots", response_model=SpotsResponse)
def list_spots(store: Store, customs: CustomRanges) -> SpotsResponse:
    """Mesas, stacks, posições e cenários para os quais há ranges."""
    return SpotsResponse.model_validate({"tables": table_summaries(store, customs)})


@router.get("/ranges", response_model=RangeResponse)
def get_range(store: Store, customs: CustomRanges, query: Spot) -> RangeResponse:
    """Range completo (169 mãos) do spot."""
    spot = resolve_spot(store, customs, query.players, query.stack, query.position, query.scenario)
    return RangeResponse.model_validate(_range_fields(spot))


@router.get("/lookup", response_model=LookupResponse)
def lookup(store: Store, customs: CustomRanges, query: Spot, hand: str) -> LookupResponse:
    """Recomendação para uma mão no spot, junto com o range completo."""
    hand_class = normalize_hand(hand)
    spot = resolve_spot(store, customs, query.players, query.stack, query.position, query.scenario)
    frequencies = spot.actions[hand_class]
    return LookupResponse.model_validate(
        {
            **_range_fields(spot),
            "hand": hand_class,
            "recommendation": recommend(frequencies),
            "frequencies": frequencies,
        }
    )


@router.post("/ranges/parse", response_model=ParseRangeResponse)
def parse_range_text(request: ParseRangeRequest) -> ParseRangeResponse:
    """Expande uma string de range ('22+,A2s+,KTo+:0.5') em classes com peso."""
    hands = parse_weighted_range(request.text)
    combos = sum(COMBO_COUNT[name] * weight for name, weight in hands.items())
    return ParseRangeResponse(hands=hands, combos=round(combos, 1))
