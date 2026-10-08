"""Testes de propriedade sobre os ranges versionados em data/ranges."""

from itertools import pairwise
from typing import Any

import pytest

from app.core.cards import COMBO_COUNT, HAND_CLASSES, TOTAL_COMBOS
from app.core.positions import positions_for, scenarios_for, spot_key

Documents = dict[tuple[int, float], dict[str, Any]]

PLAYERS = range(2, 10)
STACKS = (3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 12.0, 15.0, 20.0)

# O modelo v1 só considera o primeiro call (os demais foldam). Com menos de 5bb isso deixa
# o all-in e o call baratos demais: os ranges saturam perto de 100% e as comparações entre
# posições deixam de valer. Ver a seção "Decisões" do PLANO.md.
REGULAR_STACKS = tuple(stack for stack in STACKS if stack >= 5)
SATURATED_STACKS = tuple(stack for stack in STACKS if stack < 5)


def range_pct(spot: dict[str, Any], action: str) -> float:
    """Percentual dos 1326 combos que tomam a ação, ponderado pelas frequências."""
    combos = sum(
        COMBO_COUNT[name] * frequencies.get(action, 0.0)
        for name, frequencies in spot["actions"].items()
    )
    return 100 * combos / TOTAL_COMBOS


def push_pct(documents: Documents, players: int, stack: float, position: str) -> float:
    return range_pct(documents[(players, stack)]["spots"][spot_key(position, "open")], "allin")


def call_pct(documents: Documents, players: int, stack: float, caller: str, pusher: str) -> float:
    spot = documents[(players, stack)]["spots"][spot_key(caller, f"vs_{pusher}")]
    return range_pct(spot, "call")


def test_every_table_and_stack_was_generated(range_documents: Documents) -> None:
    assert set(range_documents) == {(players, stack) for players in PLAYERS for stack in STACKS}


def test_documents_have_the_expected_meta(range_documents: Documents) -> None:
    for (players, stack), document in range_documents.items():
        meta = document["meta"]
        assert meta["format"] == "mtt"
        assert (meta["players"], float(meta["stack_bb"])) == (players, stack)
        assert meta["ante_bb"] == 0.125
        assert meta["model"] == "chipev-nash-pushfold-v1"


def test_every_valid_spot_exists_with_all_169_hands(range_documents: Documents) -> None:
    for (players, _), document in range_documents.items():
        expected = {
            spot_key(position, scenario)
            for position in positions_for(players)
            for scenario in scenarios_for(players, position)
        }
        assert set(document["spots"]) == expected
        for key, spot in document["spots"].items():
            assert list(spot["actions"]) == list(HAND_CLASSES), key


def test_frequencies_are_valid(range_documents: Documents) -> None:
    for document in range_documents.values():
        for key, spot in document["spots"].items():
            allowed = {"allin", "fold"} if key.endswith("_open") else {"call", "fold"}
            for name, frequencies in spot["actions"].items():
                assert set(frequencies) <= allowed, (key, name)
                assert all(0 < value <= 1 for value in frequencies.values()), (key, name)
                assert sum(frequencies.values()) == pytest.approx(1.0), (key, name)


def test_aces_and_kings_always_get_the_money_in(range_documents: Documents) -> None:
    for where, document in range_documents.items():
        for key, spot in document["spots"].items():
            action = "allin" if key.endswith("_open") else "call"
            assert spot["actions"]["AA"] == {action: 1.0}, (where, key)
            assert spot["actions"]["KK"] == {action: 1.0}, (where, key)


def test_push_range_does_not_grow_with_the_stack(range_documents: Documents) -> None:
    for players in PLAYERS:
        for position in positions_for(players)[:-1]:
            sizes = [push_pct(range_documents, players, stack, position) for stack in STACKS]
            assert sizes == sorted(sizes, reverse=True), (players, position, sizes)


def test_earlier_positions_push_tighter(range_documents: Documents) -> None:
    for players in PLAYERS:
        for stack in REGULAR_STACKS:
            pushers = positions_for(players)[:-1]
            sizes = [push_pct(range_documents, players, stack, position) for position in pushers]
            assert sizes == sorted(sizes), (players, stack, sizes)


def test_utg_co_btn_sb_ordering_is_strict(range_documents: Documents) -> None:
    for players in PLAYERS:
        landmarks = [name for name in ("UTG", "CO", "BTN", "SB") if name in positions_for(players)]
        for stack in REGULAR_STACKS:
            sizes = [push_pct(range_documents, players, stack, name) for name in landmarks]
            assert all(early < late for early, late in pairwise(sizes)), (players, stack, sizes)


def test_big_blind_calls_wider_against_later_positions(range_documents: Documents) -> None:
    for players in range(3, 10):
        first_to_act = positions_for(players)[0]
        for stack in REGULAR_STACKS:
            versus_sb = call_pct(range_documents, players, stack, "BB", "SB")
            versus_first = call_pct(range_documents, players, stack, "BB", first_to_act)
            assert versus_sb > versus_first, (players, stack)


def test_position_order_only_breaks_when_push_ranges_saturate(range_documents: Documents) -> None:
    """Abaixo de 5bb uma posição só abre menos que a anterior com os dois ranges acima de 85%."""
    for players in PLAYERS:
        pushers = positions_for(players)[:-1]
        for stack in SATURATED_STACKS:
            sizes = [push_pct(range_documents, players, stack, position) for position in pushers]
            for early, late in pairwise(sizes):
                assert early <= late or late > 85, (players, stack, sizes)


def test_big_blind_order_only_breaks_when_call_ranges_saturate(range_documents: Documents) -> None:
    """Abaixo de 5bb o BB só não paga mais largo contra o SB quando já paga mais de 95%."""
    for players in range(3, 10):
        first_to_act = positions_for(players)[0]
        for stack in SATURATED_STACKS:
            versus_sb = call_pct(range_documents, players, stack, "BB", "SB")
            versus_first = call_pct(range_documents, players, stack, "BB", first_to_act)
            assert versus_sb > versus_first or versus_sb > 95, (players, stack)


def test_solver_converged_in_every_spot(range_documents: Documents) -> None:
    for where, document in range_documents.items():
        for key, spot in document["spots"].items():
            assert spot["solver"]["converged"] is True, (where, key)
            assert spot["solver"]["exploitability_bb"] < 1e-3, (where, key)
