import numpy as np
import pytest

from app.core.cards import HAND_CLASS_INDEX, HAND_CLASSES
from app.solver.equity_matrix import EquityMatrix
from app.solver.pushfold import (
    GameConfig,
    PushSubgame,
    Solution,
    SolverSettings,
    range_fraction,
    solve,
    top_range,
)

INDEX = HAND_CLASS_INDEX


@pytest.fixture(scope="module")
def heads_up_no_ante(equity_matrix: EquityMatrix) -> Solution:
    return solve(equity_matrix, GameConfig(players=2, stack_bb=10, ante_bb=0.0))


@pytest.fixture(scope="module")
def six_max(equity_matrix: EquityMatrix) -> Solution:
    return solve(equity_matrix, GameConfig(players=6, stack_bb=10))


def test_dead_money_per_seat() -> None:
    assert GameConfig(players=2, stack_bb=10, ante_bb=0.0).dead_money().tolist() == [0.5, 1.0]
    assert GameConfig(players=8, stack_bb=6).dead_money().tolist() == [0.125] * 6 + [0.625, 1.125]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"players": 1, "stack_bb": 10},
        {"players": 10, "stack_bb": 10},
        {"players": 6, "stack_bb": 1.0},
        {"players": 6, "stack_bb": 10, "ante_bb": -0.1},
    ],
)
def test_invalid_game_configs_are_rejected(kwargs: dict[str, float]) -> None:
    with pytest.raises(ValueError):
        GameConfig(**kwargs)  # type: ignore[arg-type]


def test_range_fraction_weights_classes_by_combos() -> None:
    frequencies = np.zeros(169)
    frequencies[INDEX["AA"]] = 1.0
    frequencies[INDEX["AKo"]] = 0.5

    assert range_fraction(frequencies) == pytest.approx((6 + 6) / 1326)
    assert range_fraction(np.ones(169)) == pytest.approx(1.0)


def test_top_range_picks_the_strongest_hands(equity_matrix: EquityMatrix) -> None:
    top = top_range(equity_matrix, 0.15)

    assert 0.15 <= range_fraction(top) < 0.16
    assert top[INDEX["AA"]] == top[INDEX["KK"]] == top[INDEX["AKs"]] == 1.0
    assert top[INDEX["72o"]] == top[INDEX["32o"]] == 0.0


def test_ev_accounting_heads_up(equity_matrix: EquityMatrix) -> None:
    game = PushSubgame(equity_matrix, GameConfig(players=2, stack_bb=10, ante_bb=0.0), pusher=0)

    assert game.fold_ev == pytest.approx(9.5)
    assert game.steal_ev == pytest.approx(11.0)
    assert game.showdown_pots.tolist() == pytest.approx([20.0])
    assert game.call_thresholds.tolist() == pytest.approx([9.0 / 20.0])


def test_ev_accounting_with_antes(equity_matrix: EquityMatrix) -> None:
    # 8 jogadores, 6bb, ante 0,125: pote inicial = 1,5 + 8 * 0,125 = 2,5. Pusher no CO (índice 4).
    game = PushSubgame(equity_matrix, GameConfig(players=8, stack_bb=6), pusher=4)

    assert game.fold_ev == pytest.approx(5.875)
    assert game.steal_ev == pytest.approx(8.375)
    # Callers: BTN, SB, BB. Pote = 2 * 6 + dinheiro morto de quem não está no all-in.
    assert game.showdown_pots.tolist() == pytest.approx([14.25, 13.75, 13.25])
    assert game.call_thresholds.tolist() == pytest.approx(
        [5.875 / 14.25, 5.375 / 13.75, 4.875 / 13.25]
    )


def test_push_ev_extremes(equity_matrix: EquityMatrix) -> None:
    game = PushSubgame(equity_matrix, GameConfig(players=2, stack_bb=10, ante_bb=0.0), pusher=0)

    # Ninguém paga nunca: o all-in sempre leva os blinds.
    assert game.push_ev(np.zeros((1, 169))) == pytest.approx(np.full(169, 11.0))

    # O BB paga com qualquer mão: EV = equity contra mão aleatória * pote de 20bb.
    always_called = game.push_ev(np.ones((1, 169)))
    assert always_called[INDEX["AA"]] == pytest.approx(0.852 * 20, abs=0.1)
    assert always_called[INDEX["32o"]] == pytest.approx(0.323 * 20, abs=0.1)


def test_call_equity_uses_blockers(equity_matrix: EquityMatrix) -> None:
    game = PushSubgame(equity_matrix, GameConfig(players=2, stack_bb=10, ante_bb=0.0), pusher=0)
    only_aces = np.zeros(169)
    only_aces[INDEX["AA"]] = 1.0

    equity = game.call_equity(only_aces)

    assert equity[INDEX["KK"]] == pytest.approx(equity_matrix.equity[INDEX["KK"], INDEX["AA"]])
    assert equity[INDEX["AA"]] == pytest.approx(0.5)
    # Com AKs na mão sobram 3 combos de AA; a chance de enfrentar AA cai pela metade.
    assert game.push_probability(only_aces)[INDEX["AKs"]] == pytest.approx(3 / 1225)
    assert game.push_probability(only_aces)[INDEX["72o"]] == pytest.approx(6 / 1225)


def test_heads_up_matches_published_nash_ranges(heads_up_no_ante: Solution) -> None:
    # Nash clássico de heads-up a 10bb sem ante: SB dá all-in com ~58% e o BB paga com ~37%.
    push = heads_up_no_ante.spots["SB_open"]
    call = heads_up_no_ante.spots["BB_vs_SB"]

    assert range_fraction(push) == pytest.approx(0.583, abs=0.02)
    assert range_fraction(call) == pytest.approx(0.374, abs=0.02)
    assert push[INDEX["AA"]] == push[INDEX["22"]] == push[INDEX["A2o"]] == 1.0
    assert push[INDEX["72o"]] == push[INDEX["32o"]] == 0.0
    assert call[INDEX["AA"]] == call[INDEX["A2o"]] == call[INDEX["K9o"]] == 1.0
    assert call[INDEX["72o"]] == call[INDEX["T2o"]] == 0.0


def test_spots_cover_every_pusher_and_caller(equity_matrix: EquityMatrix) -> None:
    solution = solve(equity_matrix, GameConfig(players=3, stack_bb=8))

    assert set(solution.spots) == {"BTN_open", "SB_open", "SB_vs_BTN", "BB_vs_BTN", "BB_vs_SB"}
    assert set(solution.reports) == set(solution.spots)
    assert all(frequencies.shape == (169,) for frequencies in solution.spots.values())


def test_solution_is_a_valid_strategy(six_max: Solution) -> None:
    for key, frequencies in six_max.spots.items():
        assert ((frequencies >= 0) & (frequencies <= 1)).all(), key
        assert frequencies[INDEX["AA"]] == 1.0, key
        assert frequencies[INDEX["KK"]] == 1.0, key


def test_solver_converges_to_an_equilibrium(six_max: Solution, heads_up_no_ante: Solution) -> None:
    tolerance = SolverSettings().tolerance
    for solution in (six_max, heads_up_no_ante):
        for key, report in solution.reports.items():
            assert report.converged, key
            assert report.max_change < tolerance, key
            assert report.exploitability_bb < 1e-3, key


def test_pure_hands_are_best_responses(equity_matrix: EquityMatrix, six_max: Solution) -> None:
    config = six_max.config
    positions = config.positions
    for pusher, name in enumerate(positions[:-1]):
        game = PushSubgame(equity_matrix, config, pusher)
        push = six_max.spots[f"{name}_open"]
        calls = np.array(
            [six_max.spots[f"{caller}_vs_{name}"] for caller in positions[pusher + 1 :]]
        )
        best_push, best_calls = game.best_responses(push, calls)

        # Só decisões marginais podem diferir da melhor resposta (é onde ficam as mãos mistas).
        gain = np.abs(game.push_ev(calls) - game.fold_ev)
        assert (gain[push != best_push] < 0.05).all(), name
        margin = np.abs(game.call_equity(push)[None, :] - game.call_thresholds[:, None])
        assert (margin[calls != best_calls] < 0.005).all(), name


def test_later_positions_push_wider(six_max: Solution) -> None:
    fractions = [
        range_fraction(six_max.spots[f"{name}_open"]) for name in six_max.config.positions[:-1]
    ]

    assert fractions == sorted(fractions)
    assert len(set(fractions)) == len(fractions)


def test_callers_without_blinds_share_the_same_range(six_max: Solution) -> None:
    # Fora dos blinds o dinheiro morto é igual, então o preço do call é o mesmo.
    assert np.array_equal(six_max.spots["HJ_vs_LJ"], six_max.spots["CO_vs_LJ"])
    assert np.array_equal(six_max.spots["CO_vs_LJ"], six_max.spots["BTN_vs_LJ"])
    assert range_fraction(six_max.spots["BB_vs_LJ"]) > range_fraction(six_max.spots["BTN_vs_LJ"])
    assert range_fraction(six_max.spots["BB_vs_SB"]) > range_fraction(six_max.spots["BB_vs_LJ"])


def test_shorter_stacks_push_wider(equity_matrix: EquityMatrix) -> None:
    fractions = [
        range_fraction(
            solve(equity_matrix, GameConfig(players=3, stack_bb=stack)).spots["BTN_open"]
        )
        for stack in (5, 10, 20)
    ]

    assert fractions == sorted(fractions, reverse=True)


def test_iteration_limit_is_reported_as_not_converged(equity_matrix: EquityMatrix) -> None:
    settings = SolverSettings(max_iterations=3, warmup_rounds=0)
    solution = solve(equity_matrix, GameConfig(players=2, stack_bb=10), settings)

    assert solution.reports["SB_open"].iterations == 3
    assert not solution.reports["SB_open"].converged
    assert len(HAND_CLASSES) == solution.spots["SB_open"].size
