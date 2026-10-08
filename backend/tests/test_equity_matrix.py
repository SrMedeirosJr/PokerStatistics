from pathlib import Path

import numpy as np
import pytest

from app.core.cards import COMBO_COUNT, DECK, HAND_CLASS_INDEX, HAND_CLASSES, parse_hand
from app.equity.engine import hand_vs_range
from app.equity.evaluator import encode, strength
from app.solver.equity_matrix import (
    BoardSimulator,
    EquityMatrix,
    blocker_counts,
    build_equity_matrix,
    combo_table,
    compute_equity,
    load_equity_matrix,
    save_equity_matrix,
)

INDEX = HAND_CLASS_INDEX


def brute_force_board(picked: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Referência lenta: compara diretamente todos os pares de combos num board."""
    table = combo_table()
    board = [encode(DECK[index]) for index in picked]
    used = {DECK[index] for index in picked}
    alive = np.array([first not in used and second not in used for first, second in table.combos])
    strengths = np.array(
        [
            strength([encode(first), encode(second), *board]) if is_alive else 0
            for (first, second), is_alive in zip(table.combos, alive, strict=True)
        ]
    )
    valid = table.compatible & alive[:, None] & alive[None, :]
    better = strengths[:, None] > strengths[None, :]
    equal = strengths[:, None] == strengths[None, :]
    points = (2 * better + equal) * valid

    def by_class(matrix: np.ndarray) -> np.ndarray:
        rows = np.add.reduceat(matrix.astype(np.int64), table.class_starts, axis=0)
        return np.add.reduceat(rows, table.class_starts, axis=1)

    return by_class(points), by_class(valid)


def test_combo_table_groups_the_1326_combos_by_class() -> None:
    table = combo_table()

    assert len(table.combos) == 1326
    assert table.class_starts[0] == 0
    assert table.class_sizes.sum() == 1326
    assert table.compatible.shape == (1326, 1326)
    assert not table.compatible.diagonal().any()


@pytest.mark.parametrize(
    ("hero", "villain", "expected"),
    [
        ("AA", "AA", 1),
        ("AA", "KK", 6),
        ("AA", "AKs", 2),
        ("AA", "AKo", 6),
        ("AKs", "AKs", 3),
        ("AKs", "AKo", 6),
        ("AKo", "AKs", 2),
        ("AKo", "AKo", 7),
        ("AKs", "QJs", 4),
        ("72o", "AKs", 4),
        ("72o", "AKo", 12),
    ],
)
def test_blocker_counts_are_exact(hero: str, villain: str, expected: int) -> None:
    assert blocker_counts()[INDEX[hero], INDEX[villain]] == expected


def test_blocker_counts_are_consistent() -> None:
    counts = blocker_counts()
    sizes = np.array([COMBO_COUNT[name] for name in HAND_CLASSES])

    # Tirando as 2 cartas do herói sobram C(50, 2) = 1225 combos para o adversário.
    assert (counts.sum(axis=1) == 1225).all()
    assert (counts * sizes[:, None] == (counts * sizes[:, None]).T).all()


def test_board_simulator_matches_brute_force() -> None:
    rng = np.random.default_rng(11)
    simulator = BoardSimulator()
    points = np.zeros((169, 169), dtype=np.int64)
    matchups = np.zeros((169, 169), dtype=np.int64)
    for _ in range(4):
        picked = rng.choice(len(DECK), size=5, replace=False)
        simulator.add_board(picked)
        board_points, board_matchups = brute_force_board(picked)
        points += board_points
        matchups += board_matchups

    assert (simulator.points == points).all()
    assert (simulator.matchups == matchups).all()


def test_compute_equity_is_symmetric_and_reproducible() -> None:
    equity = compute_equity(boards=40, seed=3)

    assert equity.shape == (169, 169)
    assert ((equity >= 0) & (equity <= 1)).all()
    assert np.allclose(equity + equity.T, 1.0)
    assert np.allclose(equity.diagonal(), 0.5)
    assert (equity == compute_equity(boards=40, seed=3)).all()
    assert (equity != compute_equity(boards=40, seed=4)).any()


def test_compute_equity_rejects_too_few_boards() -> None:
    with pytest.raises(ValueError):
        compute_equity(boards=0)
    with pytest.raises(RuntimeError, match="Boards insuficientes"):
        compute_equity(boards=1, seed=1)


def test_save_and_load_round_trip(tmp_path: Path) -> None:
    matrix = build_equity_matrix(boards=40, seed=3)
    path = tmp_path / "nested" / "matrix.npz"
    save_equity_matrix(matrix, path)
    loaded = load_equity_matrix(path)

    assert np.array_equal(loaded.equity, matrix.equity)
    assert np.array_equal(loaded.combos, matrix.combos)
    assert (loaded.boards, loaded.seed) == (40, 3)


def test_missing_matrix_explains_how_to_generate_it(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="python -m app.solver.equity_matrix"):
        load_equity_matrix(tmp_path / "missing.npz")


def test_versioned_matrix_is_well_formed(equity_matrix: EquityMatrix) -> None:
    equity = equity_matrix.equity

    assert equity.shape == (169, 169)
    assert equity_matrix.boards >= 20_000
    assert np.array_equal(equity_matrix.combos, blocker_counts())
    assert np.allclose(equity + equity.T, 1.0)
    assert np.allclose(equity.diagonal(), 0.5)


@pytest.mark.parametrize(
    ("hero", "villain", "expected"),
    [("AA", "KK", 0.8195), ("AKs", "QQ", 0.4603), ("AKo", "22", 0.4735)],
)
def test_versioned_matrix_has_known_equities(
    equity_matrix: EquityMatrix, hero: str, villain: str, expected: float
) -> None:
    assert equity_matrix.equity[INDEX[hero], INDEX[villain]] == pytest.approx(expected, abs=0.005)


def test_versioned_matrix_agrees_with_the_monte_carlo_engine(equity_matrix: EquityMatrix) -> None:
    rng = np.random.default_rng(2026)
    for hero_index, villain_index in rng.choice(169, size=(5, 2)):
        hero, villain = HAND_CLASSES[hero_index], HAND_CLASSES[villain_index]
        simulated = hand_vs_range(parse_hand(hero), {villain: 1.0}, iterations=30_000, seed=5)

        assert equity_matrix.equity[hero_index, villain_index] == pytest.approx(
            simulated.equity, abs=0.015
        ), f"{hero} vs {villain}"
