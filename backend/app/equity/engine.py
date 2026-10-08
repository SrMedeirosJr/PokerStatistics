"""Equity de uma mão contra um range, por Monte Carlo."""

from __future__ import annotations

import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import accumulate
from typing import Any

from app.core.cards import COMBOS_BY_CLASS, DECK, HAND_CLASS_INDEX, ParsedHand
from app.core.errors import UserInputError
from app.equity.evaluator import encode, strength

BOARD_SIZE = 5
DEFAULT_ITERATIONS = 20_000


class EquityError(UserInputError):
    """Combinação de mão, range e board que não permite calcular a equity."""


@dataclass(frozen=True)
class EquityResult:
    win: float
    tie: float
    lose: float

    @property
    def equity(self) -> float:
        """Fração do pote que o herói leva em média (empate vale meio pote)."""
        return self.win + self.tie / 2


def hand_vs_range(
    hero: ParsedHand,
    villain_range: Mapping[str, float],
    board: Sequence[str] = (),
    iterations: int = DEFAULT_ITERATIONS,
    seed: int | None = None,
) -> EquityResult:
    """Equity do herói contra um range ponderado (classe -> peso entre 0 e 1).

    Quando o herói é uma classe ('AKs'), o resultado é a média sobre os combos dela.
    Cada simulação sorteia um par (combo do herói, combo do adversário) sem carta
    repetida, com probabilidade proporcional ao peso do combo do adversário.
    """
    if iterations < 1:
        raise EquityError("O número de iterações precisa ser pelo menos 1.")
    if len(board) > BOARD_SIZE:
        raise EquityError(f"O board aceita no máximo {BOARD_SIZE} cartas.")
    if len(set(board)) != len(board):
        raise EquityError("O board tem carta repetida.")
    unknown = [name for name in villain_range if name not in HAND_CLASS_INDEX]
    if unknown:
        raise EquityError(f"Classe de mão desconhecida no range: {', '.join(unknown)}.")

    board_cards = set(board)
    hero_combos = [hero.cards] if hero.cards else COMBOS_BY_CLASS[hero.hand_class]
    hero_combos = [combo for combo in hero_combos if board_cards.isdisjoint(combo)]
    if not hero_combos:
        raise EquityError("A mão do herói usa cartas que já estão no board.")

    matchups: list[tuple[Any, Any, Any, Any]] = []
    weights: list[float] = []
    for name, weight in villain_range.items():
        if weight <= 0:
            continue
        for villain in COMBOS_BY_CLASS[name]:
            if not board_cards.isdisjoint(villain):
                continue
            for hero_combo in hero_combos:
                if villain[0] in hero_combo or villain[1] in hero_combo:
                    continue
                matchups.append((*map(encode, hero_combo), *map(encode, villain)))
                weights.append(weight)
    if not matchups:
        raise EquityError(
            "O range do adversário não tem nenhum combo compatível com a mão do herói e o board."
        )

    rng = random.Random(seed)
    fixed_board = [encode(card) for card in board]
    stub = [encode(card) for card in DECK if card not in board_cards]
    stub_size = len(stub)
    taken_size = 4 + BOARD_SIZE - len(fixed_board)
    draw = rng.random

    wins = ties = 0
    for matchup in rng.choices(matchups, cum_weights=list(accumulate(weights)), k=iterations):
        # As cartas fechadas ocupam as 4 primeiras posições; o resto completa o board.
        taken = list(matchup)
        while len(taken) < taken_size:
            card = stub[int(draw() * stub_size)]
            if card not in taken:
                taken.append(card)
        runout = fixed_board + taken[4:]
        hero_strength = strength(taken[:2] + runout)
        villain_strength = strength(taken[2:4] + runout)
        if hero_strength > villain_strength:
            wins += 1
        elif hero_strength == villain_strength:
            ties += 1

    return EquityResult(
        win=wins / iterations,
        tie=ties / iterations,
        lose=(iterations - wins - ties) / iterations,
    )
