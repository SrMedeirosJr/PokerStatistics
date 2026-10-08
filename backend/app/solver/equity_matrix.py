"""Matriz 169x169 de equity all-in preflop entre classes de mãos.

Gera e salva em `data/equity_matrix.npz`:

- `equity[i][j]`: equity média da classe `i` contra a classe `j`, considerando só
  pares de combos sem carta repetida (empate vale 0,5);
- `combos[i][j]`: quantos combos da classe `j` são compatíveis com um combo da
  classe `i` (efeito de bloqueio), calculado de forma exata.

Uso: python -m app.solver.equity_matrix --boards 100000
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import numpy as np

from app.config import EQUITY_MATRIX_PATH
from app.core.cards import COMBOS_BY_CLASS, DECK, HAND_CLASSES
from app.equity.evaluator import encode, strength

DEFAULT_PATH = EQUITY_MATRIX_PATH
DEFAULT_BOARDS = 100_000
CHUNK_SIZE = 500
NUM_CLASSES = len(HAND_CLASSES)

ProgressCallback = Callable[[int, int], None]


@dataclass(frozen=True)
class EquityMatrix:
    equity: np.ndarray
    combos: np.ndarray
    boards: int = 0
    seed: int | None = None


@dataclass(frozen=True)
class ComboTable:
    """Os 1326 combos, agrupados por classe na ordem do grid."""

    combos: tuple[tuple[str, str], ...]
    class_of: np.ndarray
    class_starts: np.ndarray
    class_sizes: np.ndarray
    masks: np.ndarray
    compatible: np.ndarray


@cache
def combo_table() -> ComboTable:
    combos = tuple(combo for name in HAND_CLASSES for combo in COMBOS_BY_CLASS[name])
    sizes = np.array([len(COMBOS_BY_CLASS[name]) for name in HAND_CLASSES], dtype=np.int64)
    starts = np.concatenate(([0], np.cumsum(sizes)[:-1]))
    class_of = np.repeat(np.arange(NUM_CLASSES), sizes)
    bit = {card: np.uint64(1) << np.uint64(index) for index, card in enumerate(DECK)}
    masks = np.array([bit[first] | bit[second] for first, second in combos], dtype=np.uint64)
    compatible = (masks[:, None] & masks[None, :]) == 0
    return ComboTable(combos, class_of, starts, sizes, masks, compatible)


def blocker_counts() -> np.ndarray:
    """combos[i][j]: combos de `j` que não repetem carta com um combo de `i` (exato)."""
    table = combo_table()
    by_row = np.add.reduceat(table.compatible, table.class_starts, axis=0, dtype=np.int64)
    pairs = np.add.reduceat(by_row, table.class_starts, axis=1)
    # Por simetria de naipes, todo combo de `i` enfrenta o mesmo número de combos de `j`.
    counts, remainder = np.divmod(pairs, table.class_sizes[:, None])
    if remainder.any():
        raise AssertionError("A contagem de combos compatíveis deveria ser inteira.")
    return counts


class BoardSimulator:
    """Acumula, board a board, o resultado de todos os confrontos entre combos compatíveis.

    Comparar os 1326 x 1326 pares em cada board é caro. Em vez disso, os combos vivos
    são ordenados por força e as contagens por classe saem de somas cumulativas, como se
    todos os pares fossem possíveis; depois são descontados só os pares que repetem carta.
    """

    def __init__(self) -> None:
        table = combo_table()
        self._table = table
        self._holes = [[encode(first), encode(second)] for first, second in table.combos]
        self._deck = [encode(card) for card in DECK]
        self._card_bits = np.uint64(1) << np.arange(len(DECK), dtype=np.uint64)
        self._strengths = np.zeros(len(table.combos), dtype=np.int32)
        self._per_combo = np.zeros((len(table.combos), NUM_CLASSES), dtype=np.int16)
        # Pares (a, b), com a < b, de combos diferentes que repetem carta. O índice
        # guarda a célula (classe de a, classe de b) já multiplicada por 3, para somar
        # o resultado do confronto (0 = derrota, 1 = empate, 2 = vitória de a).
        self._clash_first, self._clash_second = np.nonzero(np.triu(~table.compatible, k=1))
        self._clash_cell = 3 * (
            table.class_of[self._clash_first] * NUM_CLASSES + table.class_of[self._clash_second]
        )
        self._diagonal = np.arange(NUM_CLASSES)
        # points = 2 * vitórias + empates da classe da linha contra a classe da coluna.
        self.points = np.zeros((NUM_CLASSES, NUM_CLASSES), dtype=np.int64)
        self.matchups = np.zeros((NUM_CLASSES, NUM_CLASSES), dtype=np.int64)

    def add_board(self, picked: np.ndarray) -> None:
        """Soma os confrontos de um board, dado pelos índices de 5 cartas em `DECK`."""
        table = self._table
        board = [self._deck[index] for index in picked]
        alive = (table.masks & np.bitwise_or.reduce(self._card_bits[picked])) == 0
        indexes = np.flatnonzero(alive)
        holes = self._holes
        values = np.array(
            [strength(holes[index] + board) for index in indexes.tolist()], dtype=np.int32
        )
        self._strengths[indexes] = values
        count = len(indexes)

        # cumulative[r][j]: combos da classe j entre os r combos mais fracos (no máximo 12).
        order = np.argsort(values, kind="stable")
        ranked = np.zeros((count + 1, NUM_CLASSES), dtype=np.int8)
        ranked[np.arange(1, count + 1), table.class_of[indexes[order]]] = 1
        cumulative = np.cumsum(ranked, axis=0, dtype=np.int8)
        sorted_values = values[order]
        weaker = np.searchsorted(sorted_values, values, side="left")
        weaker_or_equal = np.searchsorted(sorted_values, values, side="right")

        # 2 * (mais fracos) + (iguais) = (mais fracos) + (mais fracos ou iguais).
        per_combo = self._per_combo
        per_combo[...] = 0
        per_combo[indexes] = cumulative[weaker] + cumulative[weaker_or_equal]
        self.points += np.add.reduceat(per_combo, table.class_starts, axis=0)
        alive_per_class = cumulative[count].astype(np.int64)
        self.matchups += np.outer(alive_per_class, alive_per_class)

        # A conta acima incluiu cada combo contra ele mesmo (um "empate")...
        self.points[self._diagonal, self._diagonal] -= alive_per_class
        self.matchups[self._diagonal, self._diagonal] -= alive_per_class
        # ...e os pares que repetem carta. Cada par (a, b) desconta nos dois sentidos.
        clash = alive[self._clash_first] & alive[self._clash_second]
        first = self._strengths[self._clash_first[clash]]
        second = self._strengths[self._clash_second[clash]]
        outcome = 2 * (first > second) + (first == second)
        tally = np.bincount(
            self._clash_cell[clash] + outcome, minlength=3 * NUM_CLASSES * NUM_CLASSES
        ).reshape(NUM_CLASSES, NUM_CLASSES, 3)
        tally = tally + tally.transpose(1, 0, 2)[:, :, ::-1]
        self.points -= tally[:, :, 1] + 2 * tally[:, :, 2]
        self.matchups -= tally.sum(axis=2)


def _simulate_chunk(task: tuple[np.random.SeedSequence, int]) -> tuple[np.ndarray, np.ndarray]:
    """Simula `boards` boards aleatórios e devolve (points, matchups) por par de classes."""
    seed, boards = task
    rng = np.random.default_rng(seed)
    simulator = BoardSimulator()
    for _ in range(boards):
        simulator.add_board(rng.choice(len(DECK), size=5, replace=False))
    return simulator.points, simulator.matchups


def _chunks(boards: int, seed: int | None) -> list[tuple[np.random.SeedSequence, int]]:
    sizes = [CHUNK_SIZE] * (boards // CHUNK_SIZE)
    if boards % CHUNK_SIZE:
        sizes.append(boards % CHUNK_SIZE)
    return list(zip(np.random.SeedSequence(seed).spawn(len(sizes)), sizes, strict=True))


def compute_equity(
    boards: int = DEFAULT_BOARDS,
    seed: int | None = None,
    workers: int = 1,
    on_progress: ProgressCallback | None = None,
) -> np.ndarray:
    """Estima a matriz de equity por Monte Carlo sobre `boards` boards aleatórios.

    Com `seed` definido, o resultado depende só de `boards` e `seed`, não do número
    de processos.
    """
    if boards < 1:
        raise ValueError("boards precisa ser pelo menos 1")
    points = np.zeros((NUM_CLASSES, NUM_CLASSES), dtype=np.int64)
    matchups = np.zeros((NUM_CLASSES, NUM_CLASSES), dtype=np.int64)
    tasks = _chunks(boards, seed)

    def collect(results: Iterator[tuple[np.ndarray, np.ndarray]]) -> None:
        done = 0
        for (chunk_points, chunk_matchups), (_, chunk_boards) in zip(results, tasks, strict=True):
            points[...] += chunk_points
            matchups[...] += chunk_matchups
            done += chunk_boards
            if on_progress is not None:
                on_progress(done, boards)

    if workers <= 1:
        collect(map(_simulate_chunk, tasks))
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            collect(pool.map(_simulate_chunk, tasks))

    if not matchups.all():
        raise RuntimeError("Boards insuficientes: há pares de classes sem nenhum confronto.")
    return points / (2 * matchups)


def build_equity_matrix(
    boards: int = DEFAULT_BOARDS,
    seed: int | None = None,
    workers: int = 1,
    on_progress: ProgressCallback | None = None,
) -> EquityMatrix:
    equity = compute_equity(boards, seed, workers, on_progress)
    return EquityMatrix(equity=equity, combos=blocker_counts(), boards=boards, seed=seed)


def save_equity_matrix(matrix: EquityMatrix, path: Path = DEFAULT_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        equity=matrix.equity,
        combos=matrix.combos.astype(np.int16),
        classes=np.array(HAND_CLASSES),
        boards=np.int64(matrix.boards),
        seed=np.int64(-1 if matrix.seed is None else matrix.seed),
    )


def load_equity_matrix(path: Path = DEFAULT_PATH) -> EquityMatrix:
    if not path.exists():
        raise FileNotFoundError(
            f"Matriz de equity não encontrada em {path}. "
            "Gere com: python -m app.solver.equity_matrix"
        )
    with np.load(path) as data:
        if tuple(data["classes"].tolist()) != HAND_CLASSES:
            raise ValueError(f"{path} foi gerado com outra ordem de classes; gere de novo.")
        seed = int(data["seed"])
        return EquityMatrix(
            equity=data["equity"].astype(np.float64),
            combos=data["combos"].astype(np.int64),
            boards=int(data["boards"]),
            seed=None if seed < 0 else seed,
        )


def _progress_bar(started: float) -> ProgressCallback:
    def show(done: int, total: int) -> None:
        width = 30
        filled = width * done // total
        elapsed = time.monotonic() - started
        remaining = elapsed * (total - done) / done
        sys.stdout.write(
            f"\r[{'#' * filled}{'.' * (width - filled)}] {100 * done // total:3d}% "
            f"{done}/{total} boards | {elapsed:4.0f}s decorridos, ~{remaining:4.0f}s restantes"
        )
        sys.stdout.flush()

    return show


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Gera a matriz 169x169 de equity preflop.")
    parser.add_argument("--boards", type=int, default=DEFAULT_BOARDS, help="boards simulados")
    parser.add_argument("--seed", type=int, default=None, help="semente para reproduzir")
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 1, help="processos")
    parser.add_argument("--output", type=Path, default=DEFAULT_PATH, help="arquivo .npz")
    args = parser.parse_args(argv)

    print(f"Simulando {args.boards} boards em {args.workers} processo(s)...")
    started = time.monotonic()
    matrix = build_equity_matrix(args.boards, args.seed, args.workers, _progress_bar(started))
    save_equity_matrix(matrix, args.output)
    print(f"\nMatriz salva em {args.output} ({time.monotonic() - started:.0f}s).")


if __name__ == "__main__":
    main()
