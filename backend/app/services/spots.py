"""Junta os ranges gerados pelo solver com os personalizados para responder um spot."""

from __future__ import annotations

from typing import Any

from app.core.cards import TOTAL_COMBOS
from app.core.positions import (
    normalize_position,
    normalize_scenario,
    positions_for,
    scenarios_for,
    spot_key,
)
from app.models.tables import CustomRange
from app.services.custom_ranges import CustomRangeService
from app.services.range_store import (
    CUSTOM,
    RangeStore,
    SpotRange,
    nearest_stack,
    played_combos,
    unavailable,
)


def custom_spot_range(record: CustomRange, stack_requested: float | None = None) -> SpotRange:
    key = spot_key(record.position, record.scenario)
    combos = played_combos(record.actions)
    return SpotRange(
        spot_id=f"{CUSTOM}_{record.players}max_{record.stack_bb:g}bb_{key}",
        players=record.players,
        position=record.position,
        scenario=record.scenario,
        stack_requested=record.stack_bb if stack_requested is None else stack_requested,
        stack_used=record.stack_bb,
        actions=record.actions,
        range_pct=round(100 * combos / TOTAL_COMBOS, 1),
        combos=round(combos, 1),
        source=CUSTOM,
        custom_id=record.id,
        name=record.name,
    )


def resolve_spot(
    store: RangeStore,
    customs: CustomRangeService,
    players: int,
    stack: float,
    position: str,
    scenario: str,
) -> SpotRange:
    """Range do spot no stack mais próximo do pedido.

    Concorrem os stacks gerados pelo solver e os dos ranges personalizados desse mesmo
    spot. Quando os dois existem no stack escolhido, vale o personalizado.
    """
    hero = normalize_position(players, position)
    canonical = normalize_scenario(players, hero, scenario)
    custom_by_stack = {
        record.stack_bb: record for record in customs.for_spot(players, hero, canonical)
    }
    candidates = set(store.available_stacks(players)) | set(custom_by_stack)
    if not candidates:
        raise unavailable(players)

    used = nearest_stack(candidates, stack)
    if used in custom_by_stack:
        return custom_spot_range(custom_by_stack[used], stack)
    return store.spot_at(players, used, hero, canonical, stack)


def table_summaries(store: RangeStore, customs: CustomRangeService) -> list[dict[str, Any]]:
    """Mesas com algum range (gerado ou personalizado), para montar os seletores."""
    custom_by_players: dict[int, list[CustomRange]] = {}
    for record in customs.all():
        custom_by_players.setdefault(record.players, []).append(record)

    tables: list[dict[str, Any]] = []
    for players in sorted(set(store.players()) | set(custom_by_players)):
        records = custom_by_players.get(players, [])
        stacks = set(store.available_stacks(players)) | {record.stack_bb for record in records}
        positions = positions_for(players)
        tables.append(
            {
                "players": players,
                "stacks": sorted(stacks),
                "positions": list(positions),
                "scenarios": {
                    position: list(scenarios_for(players, position)) for position in positions
                },
                "custom_spots": [
                    {
                        "id": record.id,
                        "name": record.name,
                        "stack": record.stack_bb,
                        "position": record.position,
                        "scenario": record.scenario,
                    }
                    for record in records
                ],
            }
        )
    return tables
