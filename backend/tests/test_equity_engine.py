from collections.abc import Sequence

import pytest

from app.core.cards import parse_hand
from app.core.range_parser import parse_weighted_range
from app.equity.engine import EquityError, EquityResult, hand_vs_range

TOLERANCE = 0.015
ITERATIONS = 40_000


def equity(
    hero: str,
    villain: str,
    board: Sequence[str] = (),
    iterations: int = ITERATIONS,
    seed: int | None = 7,
) -> EquityResult:
    return hand_vs_range(
        parse_hand(hero), parse_weighted_range(villain), list(board), iterations, seed
    )


@pytest.mark.parametrize(
    ("hero", "villain", "expected"),
    [
        ("AA", "KK", 0.8195),
        ("AKs", "QQ", 0.4603),
        ("AKo", "22", 0.4735),
        ("AKs", "AKs", 0.5),
        ("QQ", "QQ", 0.5),
        ("72o", "72o", 0.5),
    ],
)
def test_known_preflop_equities(hero: str, villain: str, expected: float) -> None:
    assert equity(hero, villain).equity == pytest.approx(expected, abs=TOLERANCE)


def test_results_are_fractions_that_add_up() -> None:
    result = equity("AKs", "QQ")

    assert result.win + result.tie + result.lose == pytest.approx(1.0)
    assert result.equity == pytest.approx(result.win + result.tie / 2)
    assert 0 < result.tie < 0.02


def test_class_matchups_are_symmetric() -> None:
    assert equity("JTs", "AKo").equity + equity("AKo", "JTs").equity == pytest.approx(
        1.0, abs=TOLERANCE
    )


def test_specific_cards_match_their_class_preflop() -> None:
    assert equity("AhAd", "KK").equity == pytest.approx(equity("AA", "KK").equity, abs=TOLERANCE)


def test_seed_makes_the_result_reproducible() -> None:
    assert equity("K9o", "22+,A2s+", seed=123) == equity("K9o", "22+,A2s+", seed=123)
    assert equity("K9o", "22+,A2s+", seed=123) != equity("K9o", "22+,A2s+", seed=124)


def test_complete_board_is_deterministic() -> None:
    quads = equity("AsAh", "KK", board=["Ac", "Ad", "2s", "3d", "7h"], iterations=500)
    assert (quads.win, quads.tie, quads.lose) == (1.0, 0.0, 0.0)

    chop = equity("2c2d", "33", board=["As", "Ks", "Qs", "Js", "Ts"], iterations=500)
    assert (chop.win, chop.tie, chop.lose) == (0.0, 1.0, 0.0)
    assert chop.equity == 0.5


def test_partial_board_changes_the_equity() -> None:
    # Trinca no flop contra overpair: o herói passa a ser grande favorito.
    assert equity("22", "AA", board=["2h", "7c", "Kd"]).equity > 0.88
    assert equity("22", "AA").equity < 0.20


def test_range_weights_are_respected() -> None:
    assert equity("QQ", "AA,22:0.001").equity < 0.25
    assert equity("QQ", "AA:0.001,22").equity > 0.75


def test_blockers_remove_impossible_villain_combos() -> None:
    # Com dois ases na mão do herói, o adversário só pode ter os outros dois: empate quase sempre.
    result = equity("AsAh", "AA")

    assert result.tie > 0.9
    assert result.equity == pytest.approx(0.5, abs=TOLERANCE)


def test_class_hero_skips_combos_blocked_by_the_board() -> None:
    result = equity("AKs", "QQ", board=["Ah", "7c", "2d"])

    assert result.equity > 0.85


def test_hero_cards_on_the_board_are_rejected() -> None:
    with pytest.raises(EquityError, match="já estão no board"):
        equity("AhKh", "QQ", board=["Ah", "7c", "2d"])


def test_fully_blocked_range_is_rejected() -> None:
    with pytest.raises(EquityError, match="nenhum combo compatível"):
        equity("AsAh", "AA", board=["Ad", "7c", "2d"])


def test_invalid_boards_are_rejected() -> None:
    with pytest.raises(EquityError, match="no máximo 5"):
        equity("AA", "KK", board=["2c", "3c", "4c", "5c", "7d", "8d"])
    with pytest.raises(EquityError, match="repetida"):
        equity("AA", "KK", board=["2c", "2c", "4c"])


def test_iterations_must_be_positive() -> None:
    with pytest.raises(EquityError, match="iterações"):
        equity("AA", "KK", iterations=0)
