"""Cartas, as 169 classes de mãos e a normalização da entrada do usuário."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

RANKS = "AKQJT98765432"
SUITS = "shdc"

RANK_INDEX: dict[str, int] = {rank: index for index, rank in enumerate(RANKS)}

DECK: tuple[str, ...] = tuple(rank + suit for rank in RANKS for suit in SUITS)

_SUIT_SYMBOLS = {"♠": "s", "♥": "h", "♦": "d", "♣": "c"}
_HAND_EXAMPLES = "K9o, AKs, 99 ou Kh9d"


class HandParseError(ValueError):
    """Mão ou carta inválida. A mensagem vai direto para o usuário (em português)."""


def hand_class_at(row: int, col: int) -> str:
    """Classe da célula (linha, coluna) do grid 13x13, com ranks em ordem A..2."""
    if row == col:
        return RANKS[row] * 2
    if row < col:
        return RANKS[row] + RANKS[col] + "s"
    return RANKS[col] + RANKS[row] + "o"


HAND_CLASSES: tuple[str, ...] = tuple(
    hand_class_at(row, col) for row in range(len(RANKS)) for col in range(len(RANKS))
)
HAND_CLASS_INDEX: dict[str, int] = {name: index for index, name in enumerate(HAND_CLASSES)}


def class_combos(hand_class: str) -> tuple[tuple[str, str], ...]:
    """Todos os combos (pares de cartas) de uma classe canônica."""
    high, low = hand_class[0], hand_class[1]
    if high == low:
        return tuple((high + a, low + b) for a, b in combinations(SUITS, 2))
    if hand_class[2] == "s":
        return tuple((high + suit, low + suit) for suit in SUITS)
    return tuple((high + a, low + b) for a in SUITS for b in SUITS if a != b)


COMBOS_BY_CLASS: dict[str, tuple[tuple[str, str], ...]] = {
    name: class_combos(name) for name in HAND_CLASSES
}
COMBO_COUNT: dict[str, int] = {name: len(combos) for name, combos in COMBOS_BY_CLASS.items()}
TOTAL_COMBOS = sum(COMBO_COUNT.values())


@dataclass(frozen=True)
class ParsedHand:
    """Mão informada pelo usuário: a classe e, quando vieram naipes, as duas cartas."""

    hand_class: str
    cards: tuple[str, str] | None


def _clean(text: str) -> str:
    cleaned = "".join(text.split())
    for symbol, suit in _SUIT_SYMBOLS.items():
        cleaned = cleaned.replace(symbol, suit)
    return cleaned.replace("10", "T")


def _rank(char: str) -> str:
    rank = char.upper()
    if rank not in RANK_INDEX:
        raise HandParseError(
            f"Rank inválido: '{char}'. Use A, K, Q, J, T, 9, 8, 7, 6, 5, 4, 3 ou 2."
        )
    return rank


def _suit(char: str) -> str:
    suit = char.lower()
    if suit not in SUITS:
        raise HandParseError(
            f"Naipe inválido: '{char}'. Use s (espadas), h (copas), d (ouros) ou c (paus)."
        )
    return suit


def parse_card(text: str) -> str:
    """Normaliza uma carta ('ah', 'AH', '10h', 'A♥') para o formato 'Ah'."""
    cleaned = _clean(text)
    if len(cleaned) != 2:
        raise HandParseError(f"Carta inválida: '{text}'. Use rank + naipe, como Ah ou Td.")
    return _rank(cleaned[0]) + _suit(cleaned[1])


def cards_to_class(first: str, second: str) -> str:
    """Classe canônica de duas cartas já normalizadas."""
    if first == second:
        raise HandParseError(
            f"Carta repetida: {first}{second}. As duas cartas precisam ser diferentes."
        )
    high, low = sorted((first, second), key=lambda card: RANK_INDEX[card[0]])
    if high[0] == low[0]:
        return high[0] * 2
    return high[0] + low[0] + ("s" if high[1] == low[1] else "o")


def parse_hand(text: str) -> ParsedHand:
    """Interpreta uma classe ('K9o', 'AKs', '99') ou duas cartas ('Kh9d')."""
    cleaned = _clean(text)
    if not cleaned:
        raise HandParseError(f"Informe uma mão (ex.: {_HAND_EXAMPLES}).")

    if len(cleaned) == 4:
        first = _rank(cleaned[0]) + _suit(cleaned[1])
        second = _rank(cleaned[2]) + _suit(cleaned[3])
        hand_class = cards_to_class(first, second)
        high, low = sorted(
            (first, second), key=lambda card: (RANK_INDEX[card[0]], SUITS.index(card[1]))
        )
        return ParsedHand(hand_class=hand_class, cards=(high, low))

    if len(cleaned) in (2, 3):
        high, low = sorted((_rank(cleaned[0]), _rank(cleaned[1])), key=RANK_INDEX.__getitem__)
        suffix = cleaned[2:].lower()
        if high == low:
            if suffix:
                raise HandParseError(f"Pares não têm sufixo: use apenas {high}{low}.")
            return ParsedHand(hand_class=high + low, cards=None)
        if not suffix:
            raise HandParseError(
                f"Faltou dizer se {high}{low} é suited ou offsuit: "
                f"use {high}{low}s ou {high}{low}o."
            )
        if suffix not in ("s", "o"):
            raise HandParseError(f"Sufixo inválido: '{cleaned[2]}'. Use s (suited) ou o (offsuit).")
        return ParsedHand(hand_class=high + low + suffix, cards=None)

    raise HandParseError(f"Mão inválida: '{text.strip()}'. Exemplos válidos: {_HAND_EXAMPLES}.")


def normalize_hand(text: str) -> str:
    """Classe canônica da mão informada (ex.: '9Ko' e 'Kh9d' viram 'K9o')."""
    return parse_hand(text).hand_class
