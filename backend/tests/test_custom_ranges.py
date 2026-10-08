from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_store
from app.config import DATABASE_URL_ENV
from app.core.cards import HAND_CLASSES
from app.core.positions import PositionError
from app.main import app
from app.services.custom_ranges import (
    CustomRangeError,
    normalize_actions,
    validate_custom_range,
)
from app.services.range_store import RangeStore

# Open de 40bb no CO: raise com as mãos fortes, o resto fold.
OPEN_40BB = {
    "name": "Open CO 40bb",
    "players": 8,
    "stack_bb": 40,
    "position": "CO",
    "scenario": "open",
    "actions": {
        "AA": {"raise": 1.0},
        "KK": {"raise": 1.0},
        "AKs": {"raise": 1.0},
        "A5s": {"raise": 0.5},
        "22": {"allin": 0.25, "raise": 0.25},
    },
}
LOOKUP = {"players": 8, "stack": 40, "position": "CO", "scenario": "open"}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """API com um banco vazio só para este teste."""
    monkeypatch.setenv(DATABASE_URL_ENV, f"sqlite:///{(tmp_path / 'custom.db').as_posix()}")
    with TestClient(app) as test_client:
        yield test_client


def save(client: TestClient, **overrides: Any) -> Any:
    return client.post("/api/custom-ranges", json={**OPEN_40BB, **overrides})


def lookup(client: TestClient, hand: str = "AKs", **overrides: Any) -> Any:
    return client.get("/api/lookup", params={**LOOKUP, "hand": hand, **overrides})


def test_normalize_actions_completes_the_grid() -> None:
    actions = normalize_actions({"AA": {"raise": 1.0}, "A5s": {"raise": 0.5}})

    assert list(actions) == list(HAND_CLASSES)
    assert actions["AA"] == {"raise": 1.0}
    assert actions["A5s"] == {"raise": 0.5, "fold": 0.5}
    assert actions["72o"] == {"fold": 1.0}


def test_normalize_actions_orders_and_cleans_frequencies() -> None:
    actions = normalize_actions(
        {"AA": {"fold": 0.2, "call": 0.3, "allin": 0.5}, "KK": {"raise": 0, "fold": 1}}
    )

    assert list(actions["AA"].items()) == [("allin", 0.5), ("call", 0.3), ("fold", 0.2)]
    assert actions["KK"] == {"fold": 1.0}
    assert normalize_actions({"QQ": {"raise": 1 / 3}})["QQ"] == {"raise": 0.333, "fold": 0.667}


@pytest.mark.parametrize(
    ("actions", "message"),
    [
        ({"ZZ": {"raise": 1}}, "Classe de mão desconhecida: ZZ"),
        ({"AA": {"limp": 1}}, "Ação inválida em AA: 'limp'"),
        ({"AA": {"raise": 1.5}}, "Frequência fora do intervalo em AA"),
        ({"AA": {"raise": -0.1}}, "Frequência fora do intervalo em AA"),
        ({"AA": {"raise": "tudo"}}, "Frequência inválida em AA"),
        ({"AA": {"raise": 0.7, "call": 0.6}}, "As frequências de AA somam mais de 100%"),
    ],
)
def test_normalize_actions_rejects_invalid_input(actions: Any, message: str) -> None:
    with pytest.raises(CustomRangeError, match=message):
        normalize_actions(actions)


def test_validate_normalizes_the_spot_and_names_it() -> None:
    data = validate_custom_range("  ", 8, 40.004, "co", "OPEN", {"AA": {"raise": 1}})

    assert (data.position, data.scenario, data.stack_bb) == ("CO", "open", 40.0)
    assert data.name == "CO open 40bb"
    assert validate_custom_range("", 8, 25, "bb", "vs_btn", {}).name == "BB vs BTN 25bb"


def test_validate_rejects_bad_spots() -> None:
    with pytest.raises(PositionError, match="Cenário impossível"):
        validate_custom_range("x", 8, 40, "CO", "vs_BTN", {})
    with pytest.raises(CustomRangeError, match="Stack inválido"):
        validate_custom_range("x", 8, 0, "CO", "open", {})
    with pytest.raises(CustomRangeError, match="Stack inválido"):
        validate_custom_range("x", 8, 5000, "CO", "open", {})
    with pytest.raises(CustomRangeError, match="no máximo 80 caracteres"):
        validate_custom_range("x" * 81, 8, 40, "CO", "open", {})


def test_saved_range_is_served_by_lookup(client: TestClient) -> None:
    """Aceite da Fase 7: criar um open de 40bb para o CO, salvar e consultar."""
    created = save(client)
    assert created.status_code == 201
    saved = created.json()
    assert saved["name"] == "Open CO 40bb"
    assert saved["spot_id"] == "custom_8max_40bb_CO_open"
    assert len(saved["actions"]) == 169

    body = lookup(client, "AKs").json()

    assert body["source"] == "custom"
    assert body["custom_id"] == saved["id"]
    assert body["name"] == "Open CO 40bb"
    assert body["spot_id"] == "custom_8max_40bb_CO_open"
    assert (body["stack_requested"], body["stack_used"]) == (40, 40)
    assert body["recommendation"] == "raise"
    assert body["frequencies"] == {"raise": 1.0}
    assert body["range"]["72o"] == {"fold": 1.0}
    # AA + KK (6 cada), AKs (4), metade de A5s (2) e metade de 22 (3) = 21 combos.
    assert body["combos"] == 21
    assert body["range_pct"] == 1.6


def test_lookup_reports_mixed_and_fold_for_custom_ranges(client: TestClient) -> None:
    save(client)

    assert lookup(client, "A5s").json()["recommendation"] == "mixed"
    assert lookup(client, "22").json()["frequencies"] == {"allin": 0.25, "raise": 0.25, "fold": 0.5}
    assert lookup(client, "72o").json()["recommendation"] == "fold"


def test_range_endpoint_also_serves_custom_ranges(client: TestClient) -> None:
    save(client)

    body = client.get("/api/ranges", params=LOOKUP).json()

    assert body["source"] == "custom"
    assert body["range"]["AA"] == {"raise": 1.0}


def test_saving_the_same_spot_replaces_the_range(client: TestClient) -> None:
    first = save(client).json()
    second = save(client, name="Open CO 40bb v2", actions={"AA": {"allin": 1.0}})

    assert second.status_code == 200
    assert second.json()["id"] == first["id"]
    assert len(client.get("/api/custom-ranges").json()) == 1
    assert lookup(client, "AA").json()["frequencies"] == {"allin": 1.0}
    assert lookup(client, "KK").json()["frequencies"] == {"fold": 1.0}
    assert lookup(client).json()["name"] == "Open CO 40bb v2"


def test_custom_spots_show_up_in_the_selectors(client: TestClient) -> None:
    saved = save(client, stack_bb=30, name="Open CO 30bb").json()

    tables = {table["players"]: table for table in client.get("/api/spots").json()["tables"]}

    assert tables[8]["stacks"] == [3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 60, 100]
    assert tables[8]["reference_stacks"] == [25, 40, 60, 100]
    assert tables[8]["custom_spots"] == [
        {
            "id": saved["id"],
            "name": "Open CO 30bb",
            "stack": 30,
            "position": "CO",
            "scenario": "open",
        }
    ]
    assert tables[6]["stacks"] == [3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 40, 60, 100]
    assert tables[6]["custom_spots"] == []


@pytest.mark.parametrize(
    ("overrides", "source", "used"),
    [
        # Com um range personalizado de 30bb, os vizinhos são 25 e 40 (referência).
        ({"stack": 30}, "custom", 30),
        ({"stack": 28}, "custom", 30),
        ({"stack": 34}, "custom", 30),
        # Empates (27,5 e 35): vale o menor.
        ({"stack": 27.5}, "reference", 25),
        ({"stack": 35}, "custom", 30),
        ({"stack": 36}, "reference", 40),
        ({"stack": 12}, "solver", 12),
        # O range personalizado é só do CO em open; outros spots não têm 30bb.
        ({"stack": 30, "position": "BTN"}, "reference", 25),
        ({"stack": 30, "scenario": "vs_UTG"}, "reference", 25),
        ({"stack": 30, "players": 9}, "reference", 25),
    ],
)
def test_nearest_stack_considers_custom_ranges_of_the_same_spot(
    client: TestClient, overrides: dict[str, Any], source: str, used: float
) -> None:
    save(client, stack_bb=30, name="Open CO 30bb")

    body = lookup(client, **overrides).json()

    assert (body["source"], body["stack_used"]) == (source, used)
    assert body["custom_id"] is None or source == "custom"


def test_custom_range_overrides_the_reference_table_at_the_same_stack(client: TestClient) -> None:
    before = lookup(client, "AKs").json()
    assert (before["source"], before["recommendation"]) == ("reference", "raise")
    assert before["sizes"] == {"raise": 2.2}

    save(client, actions={"AKs": {"allin": 1.0}})

    after = lookup(client, "AKs").json()
    assert (after["source"], after["recommendation"]) == ("custom", "allin")
    assert after["sizes"] == {}


def test_custom_range_overrides_the_solver_at_the_same_stack(client: TestClient) -> None:
    assert lookup(client, "AA", stack=10).json()["frequencies"] == {"allin": 1.0}

    saved = save(client, stack_bb=10, name="", actions={"AA": {"raise": 1.0}}).json()
    assert saved["name"] == "CO open 10bb"
    overridden = lookup(client, "AA", stack=10).json()
    assert (overridden["source"], overridden["frequencies"]) == ("custom", {"raise": 1.0})

    assert client.delete(f"/api/custom-ranges/{saved['id']}").status_code == 204
    restored = lookup(client, "AA", stack=10).json()
    assert (restored["source"], restored["frequencies"]) == ("solver", {"allin": 1.0})


def test_get_and_delete_by_id(client: TestClient) -> None:
    saved = save(client).json()

    assert client.get(f"/api/custom-ranges/{saved['id']}").json() == saved
    assert client.delete(f"/api/custom-ranges/{saved['id']}").status_code == 204
    assert client.get("/api/custom-ranges").json() == []

    missing = client.get(f"/api/custom-ranges/{saved['id']}")
    assert missing.status_code == 404
    assert "não encontrado" in missing.json()["detail"]
    assert client.delete("/api/custom-ranges/999").status_code == 404


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"actions": {"AA": {"limp": 1}}}, "Ação inválida em AA"),
        ({"actions": {"ZZ": {"raise": 1}}}, "Classe de mão desconhecida"),
        ({"actions": {"AA": {"raise": 2}}}, "Frequência fora do intervalo"),
        ({"stack_bb": 0}, "Stack inválido"),
        ({"players": 10}, "Número de jogadores inválido"),
        ({"position": "UTG3"}, "não existe em mesa de 8 jogadores"),
        ({"scenario": "vs_BTN"}, "Cenário impossível"),
        ({"position": "BB"}, "O BB não tem cenário 'open'"),
        ({"stack_bb": "muito"}, "'stack_bb' deve ser um número"),
        ({"actions": None}, "'actions' tem um valor inválido"),
    ],
)
def test_invalid_ranges_return_422_in_portuguese(
    client: TestClient, overrides: dict[str, Any], message: str
) -> None:
    response = save(client, **overrides)

    assert response.status_code == 422
    assert message in response.json()["detail"]
    assert client.get("/api/custom-ranges").json() == []


def test_export_and_import_round_trip(client: TestClient, tmp_path: Path) -> None:
    save(client)
    save(client, name="BB vs BTN 25bb", stack_bb=25, position="BB", scenario="vs_BTN")

    exported = client.get("/api/custom-ranges/export")
    assert exported.status_code == 200
    assert "ranges-personalizados.json" in exported.headers["content-disposition"]
    document = exported.json()
    assert document["format"] == "poker-range-helper/custom-ranges"
    assert document["version"] == 1
    assert [item["name"] for item in document["ranges"]] == ["BB vs BTN 25bb", "Open CO 40bb"]

    for saved in client.get("/api/custom-ranges").json():
        client.delete(f"/api/custom-ranges/{saved['id']}")
    assert client.get("/api/custom-ranges").json() == []

    assert client.post("/api/custom-ranges/import", json=document).json() == {
        "created": 2,
        "updated": 0,
    }
    assert lookup(client, "AKs").json()["recommendation"] == "raise"
    # Importar de novo atualiza os mesmos spots, sem duplicar.
    assert client.post("/api/custom-ranges/import", json=document).json() == {
        "created": 0,
        "updated": 2,
    }
    assert len(client.get("/api/custom-ranges").json()) == 2


def test_import_validates_the_whole_file_before_saving(client: TestClient) -> None:
    document = {
        "format": "poker-range-helper/custom-ranges",
        "version": 1,
        "ranges": [OPEN_40BB, {**OPEN_40BB, "position": "BB"}],
    }

    response = client.post("/api/custom-ranges/import", json=document)

    assert response.status_code == 422
    assert "Range 2 do arquivo é inválido: O BB não tem cenário 'open'" in response.json()["detail"]
    assert client.get("/api/custom-ranges").json() == []


@pytest.mark.parametrize(
    ("document", "message"),
    [
        ({"format": "outro", "version": 1, "ranges": []}, "Arquivo não reconhecido"),
        (
            {"format": "poker-range-helper/custom-ranges", "version": 2, "ranges": []},
            "Versão de arquivo não suportada: 2",
        ),
        ({"version": 1, "ranges": []}, "O campo 'format' é obrigatório"),
        ({"format": "x", "version": 1}, "O campo 'ranges' é obrigatório"),
    ],
)
def test_import_rejects_unknown_files(
    client: TestClient, document: dict[str, Any], message: str
) -> None:
    response = client.post("/api/custom-ranges/import", json=document)

    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_parse_range_text(client: TestClient) -> None:
    response = client.post("/api/ranges/parse", json={"text": "QQ+,AKs,A5s:0.5"})

    assert response.status_code == 200
    assert response.json() == {
        "hands": {"AA": 1.0, "AKs": 1.0, "A5s": 0.5, "KK": 1.0, "QQ": 1.0},
        "combos": 24.0,
    }

    invalid = client.post("/api/ranges/parse", json={"text": "QQ+,XYZ"})
    assert invalid.status_code == 422
    assert "Trecho de range inválido: 'XYZ'" in invalid.json()["detail"]


def test_table_with_only_custom_ranges_is_listed(client: TestClient) -> None:
    save(client, players=4, position="CO")
    app.dependency_overrides[get_store] = lambda: RangeStore()
    try:
        tables = client.get("/api/spots").json()["tables"]
        body = client.get(
            "/api/lookup",
            params={"players": 4, "stack": 12, "position": "CO", "scenario": "open", "hand": "AA"},
        ).json()
        missing = client.get(
            "/api/lookup",
            params={"players": 4, "stack": 12, "position": "BTN", "scenario": "open", "hand": "AA"},
        )
    finally:
        app.dependency_overrides.clear()

    assert [(table["players"], table["stacks"]) for table in tables] == [(4, [40])]
    assert (body["source"], body["stack_used"]) == ("custom", 40)
    assert missing.status_code == 404


def test_ranges_persist_across_restarts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DATABASE_URL_ENV, f"sqlite:///{(tmp_path / 'persist.db').as_posix()}")
    with TestClient(app) as first:
        save(first)
    with TestClient(app) as second:
        assert [item["name"] for item in second.get("/api/custom-ranges").json()] == [
            "Open CO 40bb"
        ]
        assert lookup(second).json()["source"] == "custom"
