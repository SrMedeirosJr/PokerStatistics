from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.routes_ranges import get_store
from app.core.cards import HAND_CLASSES
from app.main import app
from app.services.range_store import RangeStore, RangesUnavailableError, recommend

SPOT = {"players": 8, "stack": 6, "position": "CO", "scenario": "open"}


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def lookup(client: TestClient, **overrides: Any) -> Any:
    params = {**SPOT, "hand": "K9o", **overrides}
    return client.get("/api/lookup", params={k: v for k, v in params.items() if v is not None})


def test_spots_lists_tables_stacks_positions_and_scenarios(client: TestClient) -> None:
    response = client.get("/api/spots")

    assert response.status_code == 200
    tables = {table["players"]: table for table in response.json()["tables"]}
    assert sorted(tables) == [2, 3, 4, 5, 6, 7, 8, 9]
    assert tables[8]["stacks"] == [3, 4, 5, 6, 7, 8, 10, 12, 15, 20]
    assert tables[8]["positions"] == ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"]
    assert tables[8]["scenarios"]["UTG"] == ["open"]
    assert tables[8]["scenarios"]["CO"] == ["open", "vs_UTG", "vs_UTG1", "vs_LJ", "vs_HJ"]
    assert "open" not in tables[8]["scenarios"]["BB"]
    assert tables[2]["scenarios"] == {"SB": ["open"], "BB": ["vs_SB"]}


def test_ranges_returns_the_full_grid(client: TestClient) -> None:
    response = client.get("/api/ranges", params=SPOT)

    assert response.status_code == 200
    body = response.json()
    assert body["spot_id"] == "mtt_8max_6bb_CO_open"
    assert (body["players"], body["position"], body["scenario"]) == (8, "CO", "open")
    assert (body["stack_requested"], body["stack_used"]) == (6, 6)
    assert list(body["range"]) == list(HAND_CLASSES)
    assert body["range"]["AA"] == {"allin": 1.0}
    assert body["range"]["72o"] == {"fold": 1.0}
    assert 25 < body["range_pct"] < 60
    assert body["combos"] == pytest.approx(body["range_pct"] / 100 * 1326, abs=1)


def test_lookup_recommends_an_action_for_the_hand(client: TestClient) -> None:
    response = lookup(client)

    assert response.status_code == 200
    body = response.json()
    assert body["hand"] == "K9o"
    assert body["spot_id"] == "mtt_8max_6bb_CO_open"
    assert body["recommendation"] == "allin"
    assert body["frequencies"] == body["range"]["K9o"] == {"allin": 1.0}
    assert len(body["range"]) == 169
    assert body["range_pct"] == client.get("/api/ranges", params=SPOT).json()["range_pct"]


@pytest.mark.parametrize(
    ("hand", "expected"),
    [("Kh9d", "K9o"), ("9Ko", "K9o"), ("k9o", "K9o"), ("AsKs", "AKs"), ("7d7c", "77")],
)
def test_lookup_normalizes_the_hand(client: TestClient, hand: str, expected: str) -> None:
    assert lookup(client, hand=hand).json()["hand"] == expected


def test_lookup_against_an_all_in(client: TestClient) -> None:
    body = lookup(client, position="BB", scenario="vs_CO", hand="A9o").json()

    assert body["spot_id"] == "mtt_8max_6bb_BB_vs_CO"
    assert body["recommendation"] == "call"
    assert body["range"]["AA"] == {"call": 1.0}
    assert set(body["frequencies"]) <= {"call", "fold"}


def test_position_and_scenario_are_case_insensitive(client: TestClient) -> None:
    body = lookup(client, position="bb", scenario="VS_co").json()

    assert (body["position"], body["scenario"]) == ("BB", "vs_CO")


@pytest.mark.parametrize(
    ("requested", "used"),
    [(6, 6), (6.4, 6), (9, 8), (11, 10), (13, 12), (14, 15), (2, 3), (50, 20), (0.5, 3)],
)
def test_stack_outside_the_list_uses_the_nearest(
    client: TestClient, requested: float, used: float
) -> None:
    body = lookup(client, stack=requested).json()

    assert body["stack_requested"] == requested
    assert body["stack_used"] == used
    assert body["spot_id"] == f"mtt_8max_{used:g}bb_CO_open"


def test_chips_and_big_blind_are_converted_to_stack(client: TestClient) -> None:
    body = lookup(client, stack=None, chips=3000, big_blind=500).json()

    assert body["stack_requested"] == 6
    assert body["stack_used"] == 6

    rounded = lookup(client, stack=None, chips=4700, big_blind=400).json()
    assert rounded["stack_requested"] == pytest.approx(11.75)
    assert rounded["stack_used"] == 12


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"hand": "K9"}, "suited ou offsuit"),
        ({"hand": "KhKh"}, "Carta repetida"),
        ({"hand": "XYZ"}, "Rank inválido"),
        ({"players": 6, "position": "UTG"}, "não existe em mesa de 6 jogadores"),
        ({"position": "MP"}, "Posições válidas: UTG, UTG1, LJ, HJ, CO, BTN, SB, BB"),
        ({"scenario": "vs_BTN"}, "Cenário impossível"),
        ({"scenario": "vs_CO"}, "Cenário impossível"),
        ({"position": "BB", "scenario": "open"}, "O BB não tem cenário 'open'"),
        ({"scenario": "limp"}, "Cenário inválido"),
        ({"players": 10}, "Número de jogadores inválido"),
        ({"players": "oito"}, "'players' deve ser um número inteiro"),
        ({"players": None}, "O campo 'players' é obrigatório"),
        ({"hand": None}, "O campo 'hand' é obrigatório"),
        ({"stack": None}, "Informe o stack em big blinds"),
        ({"stack": None, "chips": 3000}, "Informe o stack em big blinds"),
        ({"stack": 0}, "'stack' deve ser maior que 0"),
        ({"stack": "muito"}, "'stack' deve ser um número"),
        ({"stack": None, "chips": 3000, "big_blind": 0}, "'big_blind' deve ser maior que 0"),
    ],
)
def test_invalid_lookups_return_422_in_portuguese(
    client: TestClient, overrides: dict[str, Any], message: str
) -> None:
    response = lookup(client, **overrides)

    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_ranges_endpoint_validates_like_lookup(client: TestClient) -> None:
    response = client.get("/api/ranges", params={**SPOT, "scenario": "vs_BTN"})

    assert response.status_code == 422
    assert "Cenário impossível" in response.json()["detail"]


def test_mixed_hands_are_reported_as_mixed(
    client: TestClient, range_documents: dict[tuple[int, float], dict[str, Any]]
) -> None:
    mixed = [
        (players, stack, key, hand)
        for (players, stack), document in range_documents.items()
        for key, spot in document["spots"].items()
        for hand, frequencies in spot["actions"].items()
        if max(frequencies.values()) < 0.8
    ]
    assert mixed, "esperava ao menos uma mão mista nos ranges gerados"
    players, stack, key, hand = mixed[0]
    position, _, scenario = key.partition("_")

    body = client.get(
        "/api/lookup",
        params={
            "players": players,
            "stack": stack,
            "position": position,
            "scenario": scenario,
            "hand": hand,
        },
    ).json()

    assert body["recommendation"] == "mixed"
    assert len(body["frequencies"]) == 2


def test_recommend_threshold() -> None:
    assert recommend({"allin": 1.0}) == "allin"
    assert recommend({"fold": 1.0}) == "fold"
    assert recommend({"call": 0.8, "fold": 0.2}) == "call"
    assert recommend({"allin": 0.15, "fold": 0.85}) == "fold"
    assert recommend({"call": 0.4, "fold": 0.6}) == "mixed"
    assert recommend({"allin": 0.79, "fold": 0.21}) == "mixed"


def test_nearest_stack_prefers_the_lower_one_on_ties(
    range_documents: dict[tuple[int, float], dict[str, Any]],
) -> None:
    store = RangeStore([range_documents[(6, 8.0)], range_documents[(6, 10.0)]])

    assert store.players() == [6]
    assert store.stacks(6) == [8.0, 10.0]
    assert store.nearest_stack(6, 9) == 8.0
    assert store.nearest_stack(6, 9.1) == 10.0
    with pytest.raises(RangesUnavailableError, match="mesa de 8 jogadores"):
        store.stacks(8)


def test_table_without_ranges_returns_404(
    client: TestClient, range_documents: dict[tuple[int, float], dict[str, Any]]
) -> None:
    app.dependency_overrides[get_store] = lambda: RangeStore([range_documents[(6, 10.0)]])
    try:
        response = lookup(client)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert "Não há ranges gerados para mesa de 8 jogadores" in response.json()["detail"]
