from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def post_equity(**overrides: Any) -> Any:
    payload = {"hero": "AA", "villain_range": "KK", "board": [], "iterations": 20000, "seed": 1}
    payload.update(overrides)
    payload = {key: value for key, value in payload.items() if value is not ...}
    return client.post("/api/equity", json=payload)


def test_equity_endpoint_returns_win_tie_lose() -> None:
    response = post_equity()

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"win", "tie", "lose", "equity"}
    assert body["win"] + body["tie"] + body["lose"] == pytest.approx(1.0)
    assert body["equity"] == pytest.approx(0.8195, abs=0.015)


def test_plan_example_request() -> None:
    response = client.post(
        "/api/equity",
        json={"hero": "Kh9d", "villain_range": "22+,A2s+,K9o+", "board": [], "iterations": 20000},
    )

    assert response.status_code == 200
    assert 0.25 < response.json()["equity"] < 0.45


def test_defaults_and_weighted_range() -> None:
    response = client.post("/api/equity", json={"hero": "QQ", "villain_range": "AA,22:0.001"})

    assert response.status_code == 200
    assert response.json()["equity"] < 0.25


def test_seed_makes_the_response_reproducible() -> None:
    assert post_equity(seed=42).json() == post_equity(seed=42).json()


def test_board_is_used() -> None:
    response = post_equity(hero="22", villain_range="AA", board=["2h", "7c", "kd"])

    assert response.status_code == 200
    assert response.json()["equity"] > 0.88


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"hero": "K9"}, "suited ou offsuit"),
        ({"hero": "KhKh"}, "Carta repetida"),
        ({"hero": "X9o"}, "Rank inválido"),
        ({"villain_range": "XYZ"}, "Trecho de range inválido"),
        ({"villain_range": "  "}, "Informe o range do adversário"),
        ({"villain_range": "AA:2"}, "Peso fora do intervalo"),
        ({"board": ["Zz"]}, "Rank inválido"),
        ({"board": ["2c", "3c", "4c", "5c", "7d", "8d"]}, "no máximo 5"),
        ({"hero": "AhKh", "board": ["Ah", "7c", "2d"]}, "já estão no board"),
        ({"iterations": 5}, "'iterations' deve ser maior ou igual a 100"),
        ({"iterations": 10_000_000}, "'iterations' deve ser menor ou igual a 200000"),
        ({"iterations": "muitas"}, "'iterations' deve ser um número inteiro"),
        ({"hero": ...}, "O campo 'hero' é obrigatório"),
        ({"board": "AhKh"}, "'board' deve ser uma lista"),
        ({"board": [1]}, "'board[0]' deve ser um texto"),
    ],
)
def test_invalid_requests_return_422_in_portuguese(overrides: dict[str, Any], message: str) -> None:
    response = post_equity(**overrides)

    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_malformed_json_returns_422_in_portuguese() -> None:
    response = client.post(
        "/api/equity", content="{isso não é json", headers={"Content-Type": "application/json"}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "O corpo da requisição não é um JSON válido."
