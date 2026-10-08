"""Posições da mesa por número de jogadores e os cenários válidos para cada uma."""

from __future__ import annotations

from app.core.errors import UserInputError

MIN_PLAYERS = 2
MAX_PLAYERS = 9

# Ordem de ação preflop. No heads-up o SB também é o botão.
POSITIONS_BY_PLAYERS: dict[int, tuple[str, ...]] = {
    2: ("SB", "BB"),
    3: ("BTN", "SB", "BB"),
    4: ("CO", "BTN", "SB", "BB"),
    5: ("HJ", "CO", "BTN", "SB", "BB"),
    6: ("LJ", "HJ", "CO", "BTN", "SB", "BB"),
    7: ("UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"),
    8: ("UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"),
    9: ("UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"),
}

OPEN = "open"
_VS_PREFIX = "vs_"
_ALIASES = {"UTG+1": "UTG1", "UTG+2": "UTG2"}


class PositionError(UserInputError):
    """Mesa, posição ou cenário inválido. A mensagem vai para o usuário (em português)."""


def positions_for(players: int) -> tuple[str, ...]:
    """Posições da mesa, em ordem de ação preflop."""
    try:
        return POSITIONS_BY_PLAYERS[players]
    except KeyError:
        raise PositionError(
            f"Número de jogadores inválido: {players}. Use de {MIN_PLAYERS} a {MAX_PLAYERS}."
        ) from None


def normalize_position(players: int, position: str) -> str:
    """Valida a posição para a mesa e devolve o nome canônico (ex.: 'utg+1' -> 'UTG1')."""
    positions = positions_for(players)
    name = position.strip().upper()
    name = _ALIASES.get(name, name)
    if name not in positions:
        raise PositionError(
            f"Posição '{position}' não existe em mesa de {players} jogadores. "
            f"Posições válidas: {', '.join(positions)}."
        )
    return name


def scenarios_for(players: int, position: str) -> tuple[str, ...]:
    """Cenários disponíveis para o herói: 'open' e/ou 'vs_{POS}' de quem age antes."""
    positions = positions_for(players)
    hero = normalize_position(players, position)
    before = positions[: positions.index(hero)]
    facing = tuple(_VS_PREFIX + pusher for pusher in before)
    # Se todos foldam até o BB a mão acaba, então ele nunca abre o pote.
    return facing if hero == positions[-1] else (OPEN, *facing)


def pusher_of(players: int, position: str, scenario: str) -> str | None:
    """Valida o cenário e devolve quem deu all-in antes do herói (None em 'open')."""
    positions = positions_for(players)
    hero = normalize_position(players, position)
    name = scenario.strip()

    if name.lower() == OPEN:
        if hero == positions[-1]:
            raise PositionError(
                "O BB não tem cenário 'open': se todos foldaram até ele, a mão já acabou."
            )
        return None

    if not name.lower().startswith(_VS_PREFIX):
        raise PositionError(
            f"Cenário inválido: '{scenario}'. Use 'open' ou 'vs_POSIÇÃO' (ex.: vs_CO)."
        )
    pusher = normalize_position(players, name[len(_VS_PREFIX) :])
    if positions.index(pusher) >= positions.index(hero):
        raise PositionError(
            f"Cenário impossível: {pusher} não age antes de {hero}, "
            "então não pode ter dado all-in antes."
        )
    return pusher


def normalize_scenario(players: int, position: str, scenario: str) -> str:
    """Forma canônica do cenário: 'open' ou 'vs_{POS}'."""
    pusher = pusher_of(players, position, scenario)
    return OPEN if pusher is None else _VS_PREFIX + pusher


def spot_key(position: str, scenario: str) -> str:
    """Chave do spot dentro do JSON de ranges (ex.: 'CO_open', 'BB_vs_CO')."""
    return f"{position}_{scenario}"
