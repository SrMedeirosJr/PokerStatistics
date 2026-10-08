"""Avaliador de mãos: eval7 quando instalado, phevaluator como fallback.

As duas bibliotecas ficam atrás da mesma interface: `encode` transforma uma carta
('Ah') no objeto que a biblioteca espera, e `strength` devolve um inteiro em que
valor maior significa mão melhor.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.core.cards import DECK

try:
    import eval7
except ImportError:  # eval7 não publica wheel para todas as versões do Python
    eval7 = None

if eval7 is not None:
    BACKEND = "eval7"
    _ENCODED: dict[str, Any] = {card: eval7.Card(card) for card in DECK}

    def strength(cards: Sequence[Any]) -> int:
        """Força de 5 a 7 cartas já codificadas; maior é melhor."""
        return eval7.evaluate(cards)

else:
    from phevaluator import evaluate_cards

    BACKEND = "phevaluator"
    _PH_RANKS = "23456789TJQKA"
    _PH_SUITS = "cdhs"
    _ENCODED = {card: _PH_RANKS.index(card[0]) * 4 + _PH_SUITS.index(card[1]) for card in DECK}

    def strength(cards: Sequence[Any]) -> int:
        """Força de 5 a 7 cartas já codificadas; maior é melhor."""
        # No phevaluator o ranking é invertido (1 = royal flush).
        return -evaluate_cards(*cards)


def encode(card: str) -> Any:
    """Converte uma carta normalizada ('Ah') para o formato do avaliador em uso."""
    return _ENCODED[card]
