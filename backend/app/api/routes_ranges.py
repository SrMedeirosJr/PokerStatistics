from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.core.cards import normalize_hand
from app.core.errors import UserInputError
from app.core.positions import positions_for, scenarios_for
from app.models.schemas import LookupResponse, RangeResponse, SpotsResponse, TableInfo
from app.services.range_store import RangeStore, SpotRange, recommend

router = APIRouter(prefix="/api", tags=["ranges"])

PositiveFloat = Annotated[float | None, Query(gt=0)]


def get_store(request: Request) -> RangeStore:
    return request.app.state.range_store


Store = Annotated[RangeStore, Depends(get_store)]


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
    }


@router.get("/spots", response_model=SpotsResponse)
def list_spots(store: Store) -> SpotsResponse:
    """Mesas, stacks, posições e cenários para os quais há ranges."""
    tables = [
        TableInfo(
            players=players,
            stacks=store.stacks(players),
            positions=list(positions_for(players)),
            scenarios={
                position: list(scenarios_for(players, position))
                for position in positions_for(players)
            },
        )
        for players in store.players()
    ]
    return SpotsResponse(tables=tables)


@router.get("/ranges", response_model=RangeResponse)
def get_range(store: Store, query: Spot) -> RangeResponse:
    """Range completo (169 mãos) do spot."""
    spot = store.spot(query.players, query.stack, query.position, query.scenario)
    return RangeResponse.model_validate(_range_fields(spot))


@router.get("/lookup", response_model=LookupResponse)
def lookup(store: Store, query: Spot, hand: str) -> LookupResponse:
    """Recomendação para uma mão no spot, junto com o range completo."""
    hand_class = normalize_hand(hand)
    spot = store.spot(query.players, query.stack, query.position, query.scenario)
    frequencies = spot.actions[hand_class]
    return LookupResponse.model_validate(
        {
            **_range_fields(spot),
            "hand": hand_class,
            "recommendation": recommend(frequencies),
            "frequencies": frequencies,
        }
    )
