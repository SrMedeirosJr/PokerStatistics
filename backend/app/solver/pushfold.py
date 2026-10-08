"""Solver push/fold: equilíbrio de Nash aproximado (chipEV) por fictitious play.

Modelo (v1): N jogadores com o mesmo stack. Todos foldam até o herói, que dá all-in
ou folda; cada jogador depois dele paga ou folda. Só o primeiro call conta: depois
dele os demais foldam (pots multiway são ignorados). As mãos dos adversários são
tratadas como independentes entre si, mas respeitam o bloqueio das cartas do herói.

Os EVs são "stack final esperado" em big blinds.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.core.cards import COMBO_COUNT, HAND_CLASSES, TOTAL_COMBOS
from app.core.positions import OPEN, positions_for, spot_key
from app.solver.equity_matrix import EquityMatrix

MODEL = "chipev-nash-pushfold-v1"

_CLASS_WEIGHTS = np.array([COMBO_COUNT[name] for name in HAND_CLASSES]) / TOTAL_COMBOS


@dataclass(frozen=True)
class GameConfig:
    players: int
    stack_bb: float
    ante_bb: float = 0.125
    small_blind_bb: float = 0.5
    big_blind_bb: float = 1.0

    def __post_init__(self) -> None:
        positions_for(self.players)
        if self.ante_bb < 0:
            raise ValueError("ante_bb não pode ser negativo")
        if self.stack_bb <= self.big_blind_bb + self.ante_bb:
            raise ValueError("stack_bb precisa ser maior que o big blind mais o ante")

    @property
    def positions(self) -> tuple[str, ...]:
        return positions_for(self.players)

    def dead_money(self) -> np.ndarray:
        """Blind + ante já postados por cada jogador, na ordem de ação."""
        dead = np.full(self.players, self.ante_bb, dtype=np.float64)
        dead[-2] += self.small_blind_bb
        dead[-1] += self.big_blind_bb
        return dead


@dataclass(frozen=True)
class SolverSettings:
    max_iterations: int = 20_000
    tolerance: float = 1e-4
    # Rodadas extras de fictitious play, cada uma partindo do resultado da anterior.
    # Sem elas, as iterações iniciais (longe do equilíbrio) deixam um resíduo na média.
    warmup_rounds: int = 2
    warmup_tolerance: float = 1e-3
    initial_push: float = 0.30
    initial_call: float = 0.15


@dataclass(frozen=True)
class SpotReport:
    iterations: int
    converged: bool
    max_change: float
    exploitability_bb: float


@dataclass(frozen=True)
class Solution:
    """Frequências (0..1) por classe para cada spot, na ordem de `HAND_CLASSES`."""

    config: GameConfig
    spots: dict[str, np.ndarray] = field(default_factory=dict)
    reports: dict[str, SpotReport] = field(default_factory=dict)


def range_fraction(frequencies: np.ndarray) -> float:
    """Fração dos 1326 combos coberta por um range com frequências por classe."""
    return float(frequencies @ _CLASS_WEIGHTS)


def top_range(matrix: EquityMatrix, fraction: float) -> np.ndarray:
    """Range inicial: as classes mais fortes contra uma mão aleatória, até `fraction` dos combos."""
    opponent = matrix.combos / matrix.combos.sum(axis=1, keepdims=True)
    strength = (opponent * matrix.equity).sum(axis=1)
    selected = np.zeros(len(HAND_CLASSES))
    covered = 0.0
    for index in np.argsort(-strength, kind="stable"):
        if covered >= fraction:
            break
        selected[index] = 1.0
        covered += _CLASS_WEIGHTS[index]
    return selected


class PushSubgame:
    """O jogo de um pusher contra os jogadores que ainda vão agir depois dele."""

    def __init__(self, matrix: EquityMatrix, config: GameConfig, pusher: int) -> None:
        dead = config.dead_money()
        pot = dead.sum()
        callers = np.arange(pusher + 1, config.players)

        self.fold_ev = config.stack_bb - dead[pusher]
        self.steal_ev = self.fold_ev + pot
        # Pote do showdown contra cada caller: os dois stacks mais o dinheiro morto dos outros.
        self.showdown_pots = 2 * config.stack_bb + pot - dead[pusher] - dead[callers]
        self.call_fold_evs = config.stack_bb - dead[callers]
        self.call_thresholds = self.call_fold_evs / self.showdown_pots
        # opponent[h][c]: probabilidade de um adversário ter a classe c se o herói tem h.
        self._opponent = matrix.combos / matrix.combos.sum(axis=1, keepdims=True)
        self._opponent_equity = self._opponent * matrix.equity

    def push_ev(self, calls: np.ndarray) -> np.ndarray:
        """EV de dar all-in com cada classe, dadas as frequências de call (callers x 169)."""
        call_prob = calls @ self._opponent.T
        # P(caller paga) * equity do herói contra o range de call dele.
        call_share = calls @ self._opponent_equity.T
        fold_prob = 1.0 - call_prob
        reached = np.ones_like(fold_prob)
        reached[1:] = np.cumprod(fold_prob[:-1], axis=0)
        everyone_folds = reached[-1] * fold_prob[-1]
        showdown = (reached * call_share * self.showdown_pots[:, None]).sum(axis=0)
        return everyone_folds * self.steal_ev + showdown

    def push_probability(self, push: np.ndarray) -> np.ndarray:
        """Chance de o pusher ter uma mão de all-in, vista por cada classe do caller."""
        return self._opponent @ push

    def call_equity(self, push: np.ndarray) -> np.ndarray:
        """Equity de cada classe contra o range de push, já com o bloqueio."""
        weight = self._opponent @ push
        share = self._opponent_equity @ push
        return np.divide(share, weight, out=np.zeros_like(share), where=weight > 0)

    def best_responses(self, push: np.ndarray, calls: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        best_push = (self.push_ev(calls) > self.fold_ev).astype(np.float64)
        equity = self.call_equity(push)
        best_calls = (equity[None, :] > self.call_thresholds[:, None]).astype(np.float64)
        return best_push, best_calls

    def exploitability(self, push: np.ndarray, calls: np.ndarray) -> float:
        """Maior ganho médio (em bb por decisão) que um jogador teria desviando sozinho."""
        push_gain = np.abs(self.push_ev(calls) - self.fold_ev)
        best_push, best_calls = self.best_responses(push, calls)
        worst = float((_CLASS_WEIGHTS * push_gain * np.abs(best_push - push)).sum())

        faces_push = _CLASS_WEIGHTS * self.push_probability(push)
        if faces_push.sum() > 0:
            call_evs = self.call_equity(push)[None, :] * self.showdown_pots[:, None]
            call_gain = np.abs(call_evs - self.call_fold_evs[:, None]) * np.abs(best_calls - calls)
            worst = max(worst, float((call_gain @ faces_push).max() / faces_push.sum()))
        return worst


def _fictitious_play(
    game: PushSubgame,
    push: np.ndarray,
    calls: np.ndarray,
    max_iterations: int,
    tolerance: float,
) -> tuple[np.ndarray, np.ndarray, int, float]:
    """Roda fictitious play a partir de (push, calls); devolve também iterações e variação."""
    change = float("inf")
    iteration = 0
    while iteration < max_iterations and change >= tolerance:
        iteration += 1
        best_push, best_calls = game.best_responses(push, calls)
        step = 1.0 / iteration
        new_push = push + step * (best_push - push)
        new_calls = calls + step * (best_calls - calls)
        change = max(float(np.abs(new_push - push).max()), float(np.abs(new_calls - calls).max()))
        push, calls = new_push, new_calls
    return push, calls, iteration, change


def solve(
    matrix: EquityMatrix, config: GameConfig, settings: SolverSettings | None = None
) -> Solution:
    """Resolve todos os spots (open de cada posição e call de cada posição seguinte)."""
    settings = settings or SolverSettings()
    positions = config.positions
    solution = Solution(config=config)

    for pusher, pusher_name in enumerate(positions[:-1]):
        game = PushSubgame(matrix, config, pusher)
        callers = positions[pusher + 1 :]
        push = top_range(matrix, settings.initial_push)
        calls = np.tile(top_range(matrix, settings.initial_call), (len(callers), 1))

        iterations = 0
        for _ in range(settings.warmup_rounds):
            push, calls, used, _ = _fictitious_play(
                game, push, calls, settings.max_iterations, settings.warmup_tolerance
            )
            iterations += used
        push, calls, used, change = _fictitious_play(
            game, push, calls, settings.max_iterations, settings.tolerance
        )

        report = SpotReport(
            iterations=iterations + used,
            converged=change < settings.tolerance,
            max_change=change,
            exploitability_bb=game.exploitability(push, calls),
        )
        keys = [spot_key(pusher_name, OPEN)]
        solution.spots[keys[0]] = push
        for caller_name, frequencies in zip(callers, calls, strict=True):
            keys.append(spot_key(caller_name, f"vs_{pusher_name}"))
            solution.spots[keys[-1]] = frequencies
        solution.reports.update(dict.fromkeys(keys, report))
    return solution
