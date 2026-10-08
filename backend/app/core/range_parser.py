"""Notação de ranges: "22+,A2s+,KTo+,T9s-65s" <-> classes de mãos.

Além da notação usual, cada trecho aceita um peso opcional depois de ":"
(ex.: "K9o:0.4"), usado para representar frequências mistas.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping

from app.core.cards import HAND_CLASS_INDEX, RANK_INDEX, RANKS
from app.core.errors import UserInputError

_HAND = r"([AKQJT98765432])([AKQJT98765432])([so]?)"
_TOKEN = re.compile(rf"^{_HAND}(?:(\+)|-{_HAND})?$")
_SEPARATORS = re.compile(r"[,;\s]+")


class RangeParseError(UserInputError):
    """Range inválido. A mensagem vai direto para o usuário (em português)."""


def _classes(high: int, low: int, suffix: str) -> list[str]:
    """Classes para os índices de rank dados; sem sufixo, vale suited e offsuit."""
    if high == low:
        return [RANKS[high] * 2]
    suffixes = (suffix,) if suffix else ("s", "o")
    return [RANKS[high] + RANKS[low] + s for s in suffixes]


def _hand_indexes(first: str, second: str, suffix: str, token: str) -> tuple[int, int]:
    high, low = sorted((RANK_INDEX[first], RANK_INDEX[second]))
    if high == low and suffix:
        raise RangeParseError(f"Pares não têm sufixo s/o: '{token}'.")
    return high, low


def _expand(token: str) -> list[str]:
    """Expande um trecho ('22+', 'A2s+', 'T9s-65s', 'AKo') nas classes que ele cobre."""
    normalized = token.upper().replace("S", "s").replace("O", "o")
    match = _TOKEN.match(normalized)
    if match is None:
        raise RangeParseError(
            f"Trecho de range inválido: '{token}'. Exemplos válidos: 22+, A2s+, KTo+, T9s-65s, AKs."
        )
    first, second, suffix, plus, end_first, end_second, end_suffix = match.groups()
    high, low = _hand_indexes(first, second, suffix, token)

    if plus:
        if high == low:
            return [RANKS[rank] * 2 for rank in range(high + 1)]
        return [
            name for kicker in range(high + 1, low + 1) for name in _classes(high, kicker, suffix)
        ]

    if end_first is None:
        return _classes(high, low, suffix)

    end_high, end_low = _hand_indexes(end_first, end_second, end_suffix, token)
    is_pair, end_is_pair = high == low, end_high == end_low
    if is_pair != end_is_pair or suffix != end_suffix:
        raise RangeParseError(
            f"Intervalo inválido: '{token}'. As duas pontas precisam ser do mesmo tipo "
            "(par, suited ou offsuit)."
        )
    if is_pair:
        start, stop = sorted((high, end_high))
        return [RANKS[rank] * 2 for rank in range(start, stop + 1)]
    if high == end_high:
        start, stop = sorted((low, end_low))
        return [
            name for kicker in range(start, stop + 1) for name in _classes(high, kicker, suffix)
        ]
    gap = low - high
    if gap == end_low - end_high:
        start, stop = sorted((high, end_high))
        return [name for top in range(start, stop + 1) for name in _classes(top, top + gap, suffix)]
    raise RangeParseError(
        f"Intervalo inválido: '{token}'. Use a mesma carta alta (A5s-A2s) "
        "ou a mesma distância entre as cartas (T9s-65s)."
    )


def _weight(text: str, token: str) -> float:
    try:
        weight = float(text)
    except ValueError:
        raise RangeParseError(f"Peso inválido em '{token}': use um número entre 0 e 1.") from None
    if not 0.0 <= weight <= 1.0:
        raise RangeParseError(f"Peso fora do intervalo em '{token}': use um número entre 0 e 1.")
    return weight


def parse_weighted_range(text: str) -> dict[str, float]:
    """Converte a string num dicionário classe -> peso (0 < peso <= 1), na ordem do grid.

    Se uma classe aparece em mais de um trecho, vale o último.
    """
    weights: dict[str, float] = {}
    for token in _SEPARATORS.split(text.strip()):
        if not token:
            continue
        body, _, weight_text = token.partition(":")
        weight = _weight(weight_text, token) if weight_text or token.endswith(":") else 1.0
        for name in _expand(body):
            weights[name] = weight
    return {
        name: weights[name]
        for name in sorted(weights, key=HAND_CLASS_INDEX.__getitem__)
        if weights[name] > 0
    }


def parse_range(text: str) -> list[str]:
    """Classes cobertas pela string de range, na ordem do grid."""
    return list(parse_weighted_range(text))


def _runs(indexes: list[int]) -> list[tuple[int, int]]:
    """Agrupa índices ordenados em intervalos (início, fim) de valores consecutivos."""
    runs: list[tuple[int, int]] = []
    for index in indexes:
        if runs and index == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], index)
        else:
            runs.append((index, index))
    return runs


def serialize_range(classes: Iterable[str]) -> str:
    """Forma compacta e canônica de um conjunto de classes (ex.: '22+,A2s+,KTo+')."""
    selected = set(classes)
    unknown = selected - HAND_CLASS_INDEX.keys()
    if unknown:
        raise RangeParseError(f"Classe de mão desconhecida: {', '.join(sorted(unknown))}.")

    tokens: list[str] = []
    pairs = sorted(RANK_INDEX[name[0]] for name in selected if len(name) == 2)
    for start, end in _runs(pairs):
        if start == end:
            tokens.append(RANKS[start] * 2)
        elif start == 0:
            tokens.append(RANKS[end] * 2 + "+")
        else:
            tokens.append(f"{RANKS[start] * 2}-{RANKS[end] * 2}")

    for suffix in ("s", "o"):
        for high in range(len(RANKS) - 1):
            top = RANKS[high]
            kickers = sorted(
                RANK_INDEX[name[1]]
                for name in selected
                if len(name) == 3 and name[0] == top and name[2] == suffix
            )
            for start, end in _runs(kickers):
                if start == end:
                    tokens.append(top + RANKS[start] + suffix)
                elif start == high + 1:
                    tokens.append(top + RANKS[end] + suffix + "+")
                else:
                    tokens.append(f"{top}{RANKS[start]}{suffix}-{top}{RANKS[end]}{suffix}")
    return ",".join(tokens)


def serialize_weighted_range(weights: Mapping[str, float]) -> str:
    """Como `serialize_range`, mas preservando pesos menores que 1 (ex.: 'K9o:0.4')."""
    groups: dict[float, list[str]] = {}
    for name, weight in weights.items():
        rounded = round(float(weight), 4)
        if rounded > 1:
            raise RangeParseError(f"Peso fora do intervalo para {name}: {weight}.")
        if rounded > 0:
            groups.setdefault(rounded, []).append(name)

    parts: list[str] = []
    for weight in sorted(groups, reverse=True):
        tokens = serialize_range(groups[weight]).split(",")
        parts.extend(tokens if weight == 1 else (f"{token}:{weight:g}" for token in tokens))
    return ",".join(parts)
