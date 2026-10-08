import pytest

from app.core.positions import (
    PositionError,
    normalize_position,
    normalize_scenario,
    positions_for,
    pusher_of,
    scenarios_for,
    spot_key,
)


@pytest.mark.parametrize(
    ("players", "expected"),
    [
        (2, ("SB", "BB")),
        (3, ("BTN", "SB", "BB")),
        (4, ("CO", "BTN", "SB", "BB")),
        (5, ("HJ", "CO", "BTN", "SB", "BB")),
        (6, ("LJ", "HJ", "CO", "BTN", "SB", "BB")),
        (7, ("UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB")),
        (8, ("UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB")),
        (9, ("UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB")),
    ],
)
def test_positions_table(players: int, expected: tuple[str, ...]) -> None:
    assert positions_for(players) == expected
    assert len(positions_for(players)) == players


@pytest.mark.parametrize("players", [0, 1, 10])
def test_invalid_table_size(players: int) -> None:
    with pytest.raises(PositionError, match="Número de jogadores inválido"):
        positions_for(players)


def test_normalize_position() -> None:
    assert normalize_position(8, "co") == "CO"
    assert normalize_position(8, " utg+1 ") == "UTG1"
    assert normalize_position(9, "UTG+2") == "UTG2"


def test_position_must_exist_at_the_table() -> None:
    with pytest.raises(PositionError) as error:
        normalize_position(6, "UTG")

    assert "mesa de 6 jogadores" in str(error.value)
    assert "LJ, HJ, CO, BTN, SB, BB" in str(error.value)


def test_scenarios_for_each_seat() -> None:
    assert scenarios_for(8, "UTG") == ("open",)
    assert scenarios_for(8, "CO") == ("open", "vs_UTG", "vs_UTG1", "vs_LJ", "vs_HJ")
    assert scenarios_for(8, "SB") == (
        "open",
        "vs_UTG",
        "vs_UTG1",
        "vs_LJ",
        "vs_HJ",
        "vs_CO",
        "vs_BTN",
    )
    assert scenarios_for(2, "SB") == ("open",)
    assert scenarios_for(2, "BB") == ("vs_SB",)


def test_big_blind_never_opens() -> None:
    assert "open" not in scenarios_for(8, "BB")
    assert len(scenarios_for(8, "BB")) == 7
    with pytest.raises(PositionError, match="BB não tem cenário 'open'"):
        pusher_of(8, "BB", "open")


def test_pusher_of() -> None:
    assert pusher_of(8, "CO", "open") is None
    assert pusher_of(8, "BB", "vs_CO") == "CO"
    assert pusher_of(8, "bb", "VS_co") == "CO"


@pytest.mark.parametrize("scenario", ["vs_BTN", "vs_BB", "vs_CO"])
def test_pusher_must_act_before_hero(scenario: str) -> None:
    with pytest.raises(PositionError, match="Cenário impossível"):
        pusher_of(8, "CO", scenario)


def test_unknown_scenarios_are_rejected() -> None:
    with pytest.raises(PositionError, match="Cenário inválido"):
        pusher_of(8, "CO", "limp")
    with pytest.raises(PositionError, match="não existe em mesa de 6"):
        pusher_of(6, "BB", "vs_UTG")


def test_normalize_scenario_and_spot_key() -> None:
    assert normalize_scenario(8, "co", "OPEN") == "open"
    assert normalize_scenario(8, "bb", "VS_co") == "vs_CO"
    assert spot_key("CO", "open") == "CO_open"
    assert spot_key("BB", "vs_CO") == "BB_vs_CO"
