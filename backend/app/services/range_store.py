"""Ranges em memória: carrega os JSONs de data/ranges e responde consultas de spots."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import RANGES_DIR, REFERENCE_DIR
from app.core.cards import COMBO_COUNT, TOTAL_COMBOS
from app.core.positions import normalize_position, normalize_scenario, spot_key

Actions = Mapping[str, Mapping[str, float]]

# Abaixo disso nenhuma ação domina e a recomendação vira "mixed".
PURE_RECOMMENDATION = 0.8
MIXED = "mixed"
FOLD = "fold"

SOLVER = "solver"
REFERENCE = "reference"
CUSTOM = "custom"


class RangesUnavailableError(LookupError):
    """Não há ranges carregados para a mesa pedida. A mensagem vai para o usuário."""


@dataclass(frozen=True)
class SpotRange:
    spot_id: str
    players: int
    position: str
    scenario: str
    stack_requested: float
    stack_used: float
    actions: Actions
    range_pct: float
    combos: float
    # "solver" (push/fold calculado), "reference" (heurística de stack fundo) ou
    # "custom" (salvo pelo usuário).
    source: str = SOLVER
    custom_id: int | None = None
    name: str | None = None
    # Tamanho sugerido de cada aposta, em bb (só nas tabelas de referência).
    sizes: Mapping[str, float] = field(default_factory=dict)


def recommend(frequencies: Mapping[str, float]) -> str:
    """Ação de maior frequência, ou 'mixed' quando nenhuma chega a 80%."""
    action, frequency = max(frequencies.items(), key=lambda item: item[1])
    return action if frequency >= PURE_RECOMMENDATION else MIXED


def played_combos(actions: Actions) -> float:
    """Combos (de 1326) que não foldam, ponderados pela frequência."""
    return sum(
        COMBO_COUNT[name] * (1.0 - frequencies.get(FOLD, 0.0))
        for name, frequencies in actions.items()
    )


def nearest_stack(available: Iterable[float], stack: float) -> float:
    """Stack disponível mais próximo do pedido; no empate, o menor."""
    return min(available, key=lambda candidate: (abs(candidate - stack), candidate))


def unavailable(players: int) -> RangesUnavailableError:
    return RangesUnavailableError(
        f"Não há ranges gerados para mesa de {players} jogadores. "
        "Gere com: python -m app.solver.generate"
    )


class RangeStore:
    def __init__(self, documents: Iterable[Mapping[str, Any]] = ()) -> None:
        self._tables: dict[int, dict[float, Mapping[str, Any]]] = {}
        self._metas: dict[tuple[int, float], Mapping[str, Any]] = {}
        for document in documents:
            self.add(document)

    @classmethod
    def from_directory(cls, *directories: Path) -> RangeStore:
        """Carrega todos os JSONs das pastas dadas (por padrão, solver + referência)."""
        return cls(
            json.loads(path.read_text(encoding="utf-8"))
            for directory in directories or (RANGES_DIR, REFERENCE_DIR)
            for path in sorted(directory.glob("*.json"))
        )

    def add(self, document: Mapping[str, Any]) -> None:
        meta = document["meta"]
        players, stack = int(meta["players"]), float(meta["stack_bb"])
        self._tables.setdefault(players, {})[stack] = document["spots"]
        self._metas[(players, stack)] = meta

    def players(self) -> list[int]:
        return sorted(self._tables)

    def source(self, players: int, stack: float) -> str:
        """'reference' para as tabelas heurísticas de stack fundo; 'solver' para o resto."""
        model = str(self._metas[(players, stack)].get("model", ""))
        return REFERENCE if model.startswith(REFERENCE) else SOLVER

    def available_stacks(self, players: int) -> list[float]:
        """Stacks com ranges gerados para a mesa (lista vazia se não houver nenhum)."""
        return sorted(self._tables.get(players, ()))

    def reference_stacks(self, players: int) -> list[float]:
        return [
            stack
            for stack in self.available_stacks(players)
            if self.source(players, stack) == REFERENCE
        ]

    def stacks(self, players: int) -> list[float]:
        stacks = self.available_stacks(players)
        if not stacks:
            raise unavailable(players)
        return stacks

    def nearest_stack(self, players: int, stack: float) -> float:
        return nearest_stack(self.stacks(players), stack)

    def spot_at(
        self, players: int, stack_used: float, position: str, scenario: str, stack_requested: float
    ) -> SpotRange:
        """Range gerado para um stack que existe; posição e cenário já normalizados."""
        key = spot_key(position, scenario)
        spot = self._tables[players][stack_used][key]
        actions: Actions = spot["actions"]
        combos = played_combos(actions)
        prefix = self._metas[(players, stack_used)]["format"]
        return SpotRange(
            spot_id=f"{prefix}_{players}max_{stack_used:g}bb_{key}",
            players=players,
            position=position,
            scenario=scenario,
            stack_requested=stack_requested,
            stack_used=stack_used,
            actions=actions,
            range_pct=round(100 * combos / TOTAL_COMBOS, 1),
            combos=round(combos, 1),
            source=self.source(players, stack_used),
            sizes=spot.get("sizes", {}),
        )

    def spot(self, players: int, stack: float, position: str, scenario: str) -> SpotRange:
        """Range do spot, usando o stack disponível mais próximo do pedido."""
        hero = normalize_position(players, position)
        canonical = normalize_scenario(players, hero, scenario)
        return self.spot_at(players, self.nearest_stack(players, stack), hero, canonical, stack)
