"""Tabelas de referência (heurística de stack fundo): modelo, arquivos gerados e API."""

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import REFERENCE_DIR
from app.core.cards import HAND_CLASS_INDEX, HAND_CLASSES
from app.core.positions import positions_for, scenarios_for, spot_key
from app.main import app
from app.reference.generate import generate, main, reference_file_name, table_to_document
from app.reference.model import (
    MODEL,
    OPEN_FRACTION,
    REFERENCE_STACKS,
    ReferenceTable,
    build_table,
    continue_fractions,
    coverage,
    equity_against,
    open_size,
    playability_bonus,
    three_bet_size,
    top_fraction,
)
from app.solver.equity_matrix import EquityMatrix

INDEX = HAND_CLASS_INDEX
PLAYERS = range(2, 10)


@pytest.fixture(scope="module")
def tables(equity_matrix: EquityMatrix) -> dict[tuple[int, float], ReferenceTable]:
    return {
        (players, stack): build_table(equity_matrix, players, stack)
        for players in PLAYERS
        for stack in REFERENCE_STACKS
    }


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def hands(frequencies: np.ndarray) -> set[str]:
    return {name for name, value in zip(HAND_CLASSES, frequencies, strict=True) if value > 0}


def test_playability_rewards_suited_connected_hands_and_depth() -> None:
    shallow, deep = playability_bonus(25), playability_bonus(100)

    assert shallow[INDEX["T9s"]] > shallow[INDEX["T9o"]] > shallow[INDEX["T4o"]] == 0
    assert shallow[INDEX["T9s"]] > shallow[INDEX["T7s"]] > shallow[INDEX["T4s"]]
    # AKs é conectada, mas com A/K quase não há sequência pelos dois lados.
    assert shallow[INDEX["AKs"]] < shallow[INDEX["T9s"]]
    assert deep[INDEX["T9s"]] > shallow[INDEX["T9s"]]
    assert deep[INDEX["22"]] > shallow[INDEX["22"]]


def test_top_fraction_hits_the_target_and_respects_the_filter(equity_matrix: EquityMatrix) -> None:
    scores = equity_against(equity_matrix, np.ones(169))

    assert coverage(top_fraction(scores, 0.20)) == pytest.approx(0.20, abs=0.006)
    assert coverage(top_fraction(scores, 0.0)) == 0
    suited = np.array([name.endswith("s") for name in HAND_CLASSES])
    assert all(name.endswith("s") for name in hands(top_fraction(scores, 0.05, allowed=suited)))


def test_open_ranges_follow_the_target_widths(
    tables: dict[tuple[int, float], ReferenceTable],
) -> None:
    for (players, stack), table in tables.items():
        positions = positions_for(players)
        for index, position in enumerate(positions[:-1]):
            target = 0.80 if players == 2 else OPEN_FRACTION[players - 1 - index]
            opening = table.spots[spot_key(position, "open")].actions["raise"]
            assert coverage(opening) == pytest.approx(target, abs=0.006), (players, stack, position)


def test_later_positions_open_wider(tables: dict[tuple[int, float], ReferenceTable]) -> None:
    for (players, stack), table in tables.items():
        widths = [
            coverage(table.spots[spot_key(position, "open")].actions["raise"])
            for position in positions_for(players)[:-1]
        ]
        assert widths == sorted(widths), (players, stack)
        assert len(set(widths)) == len(widths), (players, stack)


def test_premium_hands_are_always_played(tables: dict[tuple[int, float], ReferenceTable]) -> None:
    for where, table in tables.items():
        for key, spot in table.spots.items():
            aggressive = sum(
                spot.actions[action] for action in ("raise", "allin") if action in spot.actions
            )
            assert aggressive[INDEX["AA"]] == 1, (where, key)
            assert aggressive[INDEX["KK"]] == 1, (where, key)
            if key.endswith("_open"):
                assert aggressive[INDEX["AKs"]] == 1, (where, key)


def test_trash_is_folded_from_early_position(
    tables: dict[tuple[int, float], ReferenceTable],
) -> None:
    for stack in REFERENCE_STACKS:
        opening = hands(tables[(8, stack)].spots["UTG_open"].actions["raise"])
        assert not {"72o", "32o", "T4o", "83s", "K2o", "Q7o"} & opening
        assert {"AA", "AKs", "AQs", "AKo", "TT", "KQs", "JTs"} <= opening


def test_responses_are_consistent(tables: dict[tuple[int, float], ReferenceTable]) -> None:
    for (players, stack), table in tables.items():
        shove = stack <= 30
        for key, spot in table.spots.items():
            if key.endswith("_open"):
                assert set(spot.actions) == {"raise"}
                continue
            three_bet = "allin" if shove else "raise"
            assert set(spot.actions) == {three_bet, "call"}, (players, stack, key)
            total = spot.actions[three_bet] + spot.actions["call"]
            assert set(np.unique(total)) <= {0.0, 1.0}, (players, stack, key)
            assert (set(spot.sizes) == set()) if shove else (set(spot.sizes) == {"raise"})


def test_big_blind_defends_wider_than_the_other_seats(
    tables: dict[tuple[int, float], ReferenceTable],
) -> None:
    for stack in REFERENCE_STACKS:
        table = tables[(8, stack)]

        def defended(hero: str, opener: str, table: ReferenceTable = table) -> float:
            return sum(
                coverage(frequencies)
                for frequencies in table.spots[f"{hero}_vs_{opener}"].actions.values()
            )

        assert defended("BB", "CO") > defended("BTN", "CO") > defended("SB", "CO") * 0.8
        assert defended("BB", "BTN") > defended("BB", "UTG")
        assert defended("BB", "SB") <= 0.80 + 0.006


def test_continue_fractions_by_seat_and_depth() -> None:
    value, bluff, call = continue_fractions(8, "BTN", 0.33, 60)
    assert value == pytest.approx(0.11 * 0.33 + 0.004)
    assert 0 < bluff < value
    assert call == pytest.approx(0.30 * 0.33)

    # Com 25 bb o 3-bet é all-in: sem blefe, e paga-se menos.
    shove_value, shove_bluff, shove_call = continue_fractions(8, "BTN", 0.33, 25)
    assert shove_bluff == 0
    assert shove_value > value
    assert shove_call < call

    assert continue_fractions(8, "SB", 0.47, 60)[2] < continue_fractions(8, "BTN", 0.33, 60)[2]
    assert continue_fractions(8, "BB", 0.47, 60)[2] > 0.5
    assert continue_fractions(8, "BTN", 0.33, 100)[1] > bluff


def test_bet_sizes() -> None:
    assert open_size(8, "CO", 60) == 2.2
    assert open_size(8, "SB", 60) == 3.0
    assert open_size(8, "CO", 25) == 2.0
    assert open_size(8, "SB", 25) == 2.5
    assert open_size(2, "SB", 60) == 2.2
    # Em posição 3x o raise; nos blinds (fora de posição) 4x.
    assert three_bet_size(8, "BTN", "CO", 60) == 6.6
    assert three_bet_size(8, "SB", "BTN", 60) == 8.8
    assert three_bet_size(8, "BB", "BTN", 60) == 8.8
    # Contra o SB o BB joga em posição; no heads-up o BB fica fora de posição.
    assert three_bet_size(8, "BB", "SB", 60) == 9.0
    assert three_bet_size(2, "BB", "SB", 60) == 8.8


def test_reference_ranges_look_like_standard_charts(
    tables: dict[tuple[int, float], ReferenceTable],
) -> None:
    table = tables[(8, 60.0)]

    button = hands(table.spots["BTN_open"].actions["raise"])
    assert {"22", "A2s", "K2s", "Q5s", "T8s", "76s", "54s", "A2o", "K9o", "QTo", "JTo"} <= button
    assert not {"72o", "83o", "T2o", "J4o", "93s"} & button

    versus_cutoff = table.spots["BTN_vs_CO"]
    assert {"AA", "KK", "QQ", "AKs", "AKo"} <= hands(versus_cutoff.actions["raise"])
    assert {"99", "77", "KQs", "JTs", "AQo"} <= hands(versus_cutoff.actions["call"])
    assert not {"72o", "K4o", "95o"} & (
        hands(versus_cutoff.actions["raise"]) | hands(versus_cutoff.actions["call"])
    )

    # O exemplo que motivou a tabela: KTo no SB com 60 bb é raise, não all-in.
    small_blind = table.spots["SB_open"]
    assert "KTo" in hands(small_blind.actions["raise"])
    assert small_blind.sizes == {"raise": 3.0}


def test_document_format(equity_matrix: EquityMatrix) -> None:
    table = build_table(equity_matrix, 3, 25)
    document = table_to_document(table, datetime(2026, 10, 8, 20, 0, tzinfo=UTC))

    assert document["meta"] == {
        "format": "ref",
        "players": 3,
        "stack_bb": 25,
        "model": "reference-heuristic-v1",
        "generated_at": "2026-10-08T20:00:00Z",
    }
    assert set(document["spots"]) == {"BTN_open", "SB_open", "SB_vs_BTN", "BB_vs_BTN", "BB_vs_SB"}
    assert document["spots"]["BTN_open"]["actions"]["AA"] == {"raise": 1.0}
    assert document["spots"]["BTN_open"]["actions"]["72o"] == {"fold": 1.0}
    assert document["spots"]["BTN_open"]["sizes"] == {"raise": 2.0}
    assert document["spots"]["BB_vs_BTN"]["actions"]["AA"] == {"allin": 1.0}
    assert document["spots"]["BB_vs_BTN"]["sizes"] == {}


def test_cli_writes_files(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--players", "2-3", "--stacks", "25,60", "--output-dir", str(tmp_path)]) == 0

    assert sorted(path.name for path in tmp_path.glob("*.json")) == [
        "ref_2max_25bb.json",
        "ref_2max_60bb.json",
        "ref_3max_25bb.json",
        "ref_3max_60bb.json",
    ]
    assert "4 arquivo(s) de referência" in capsys.readouterr().out
    assert reference_file_name(8, 60.0) == "ref_8max_60bb.json"
    assert main(["--matrix", str(tmp_path / "missing.npz"), "--output-dir", str(tmp_path)]) == 1


def test_versioned_files_cover_every_table_and_spot() -> None:
    files = {path.name for path in REFERENCE_DIR.glob("*.json")}
    assert files == {
        reference_file_name(players, stack) for players in PLAYERS for stack in REFERENCE_STACKS
    }

    for path in REFERENCE_DIR.glob("*.json"):
        document = json.loads(path.read_text(encoding="utf-8"))
        players = document["meta"]["players"]
        assert document["meta"]["model"] == MODEL
        assert set(document["spots"]) == {
            spot_key(position, scenario)
            for position in positions_for(players)
            for scenario in scenarios_for(players, position)
        }
        for key, spot in document["spots"].items():
            assert list(spot["actions"]) == list(HAND_CLASSES), (path.name, key)
            for name, frequencies in spot["actions"].items():
                assert set(frequencies) <= {"allin", "raise", "call", "fold"}
                assert sum(frequencies.values()) == pytest.approx(1.0), (path.name, key, name)


def test_versioned_files_match_the_current_model(
    equity_matrix: EquityMatrix, tmp_path: Path
) -> None:
    """Se a heurística mudar, os arquivos precisam ser gerados de novo."""
    generate(equity_matrix, list(PLAYERS), list(REFERENCE_STACKS), tmp_path)

    for fresh in tmp_path.glob("*.json"):
        versioned = json.loads((REFERENCE_DIR / fresh.name).read_text(encoding="utf-8"))
        current = json.loads(fresh.read_text(encoding="utf-8"))
        assert versioned["spots"] == current["spots"], fresh.name


def lookup(client: TestClient, **params: Any) -> dict[str, Any]:
    return client.get("/api/lookup", params=params).json()


def test_lookup_serves_reference_ranges_for_deep_stacks(client: TestClient) -> None:
    body = lookup(client, players=8, stack=60, position="SB", scenario="open", hand="KTo")

    assert body["source"] == "reference"
    assert body["spot_id"] == "ref_8max_60bb_SB_open"
    assert body["recommendation"] == "raise"
    assert body["frequencies"] == {"raise": 1.0}
    assert body["sizes"] == {"raise": 3.0}
    assert (body["custom_id"], body["name"]) == (None, None)


def test_lookup_against_a_raise(client: TestClient) -> None:
    spot = {"players": 8, "position": "BTN", "scenario": "vs_CO"}

    deep = lookup(client, **spot, stack=60, hand="AA")
    assert (deep["recommendation"], deep["sizes"]) == ("raise", {"raise": 6.6})
    assert lookup(client, **spot, stack=60, hand="99")["recommendation"] == "call"
    assert lookup(client, **spot, stack=60, hand="72o")["recommendation"] == "fold"

    shallow = lookup(client, **spot, stack=25, hand="AA")
    assert (shallow["recommendation"], shallow["sizes"]) == ("allin", {})


def test_solver_ranges_have_no_sizes(client: TestClient) -> None:
    body = lookup(client, players=8, stack=10, position="SB", scenario="open", hand="KTo")

    assert (body["source"], body["sizes"]) == ("solver", {})
    assert body["recommendation"] == "allin"
