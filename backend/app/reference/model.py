"""Tabelas de referência para stacks fundos (25 a 100 bb): raise, 3-bet, call e fold.

NÃO são solução de solver. Com stack fundo a decisão depende do jogo pós-flop, que este
projeto não modela. Aqui cada range sai de uma heurística simples e explícita:

1. Toda mão recebe uma nota: a equity all-in (da matriz de equity do projeto) contra uma
   mistura de mão aleatória e range forte, mais um bônus de jogabilidade para mãos do
   mesmo naipe, conectadas e pares, que cresce com o stack.
2. Em 'open', a posição abre com raise as mãos de maior nota até uma largura que depende
   de quantos jogadores ainda vão agir (`OPEN_FRACTION`).
3. Contra um raise, o herói continua com uma fração das mãos que depende da largura de
   quem abriu e da posição dele: 3-bet por valor com as de maior equity contra a parte
   forte do range do adversário, call com as do meio e 3-bet de blefe com as mais fracas
   que ainda continuam e têm bloqueador (A ou K do mesmo naipe). Com 25 bb o 3-bet é
   all-in e não há blefe.

4. O corte de cada range não é seco: as mãos numa faixa em torno dele entram com
   frequência parcial (25%, 50% ou 75%), e o mesmo vale para a fronteira entre 3-bet e
   call. Essas porcentagens só marcam as mãos marginais; não são frequências de solver.

Os números abaixo foram ajustados à mão para os ranges ficarem parecidos com tabelas
usuais de abertura. São um ponto de partida para estudo e para edição em "Meus ranges".
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.core.cards import COMBO_COUNT, HAND_CLASSES, RANK_INDEX, TOTAL_COMBOS
from app.core.positions import OPEN, positions_for, spot_key
from app.solver.equity_matrix import EquityMatrix

MODEL = "reference-heuristic-v2"
REFERENCE_STACKS = (25.0, 40.0, 60.0, 100.0)

# Até este stack o 3-bet de referência é all-in (não sobra jogo pós-flop relevante).
SHOVE_3BET_MAX_STACK = 30.0

# Fração de mãos aberta com raise, por número de jogadores que ainda vão agir.
OPEN_FRACTION = {1: 0.50, 2: 0.47, 3: 0.33, 4: 0.26, 5: 0.215, 6: 0.18, 7: 0.155, 8: 0.135}
# No heads-up o SB é o botão e joga em posição depois do flop.
HEADS_UP_OPEN_FRACTION = 0.80

# Peso da equity contra mão aleatória na nota de abertura (o resto é contra range forte).
# Quem abre tarde enfrenta quase só os blinds, que defendem largo; quem abre cedo
# enfrenta mais jogadores e, quando recebe ação, é de ranges fortes.
RANDOM_WEIGHT = {1: 0.75, 2: 0.75, 3: 0.60, 4: 0.50, 5: 0.45, 6: 0.40, 7: 0.35, 8: 0.30}
HEADS_UP_RANDOM_WEIGHT = 0.85
STRONG_RANGE = 0.15

# Bônus de jogabilidade, em pontos de equity: (valor com 25 bb, acréscimo até 100 bb).
SUITED_BONUS = (0.045, 0.02)
PAIR_BONUS = (0.0, 0.03)
# Por distância entre as cartas: conectadas, 1 de intervalo, 2 de intervalo.
CONNECTED_BONUS = (0.03, 0.022, 0.01)
# Com A ou K como carta alta quase não há sequência pelos dois lados.
HIGH_CARD_CONNECTED_FACTOR = 0.4

# Parte do range de abertura que continua contra um 3-bet; mede o valor de um 3-bet.
CONTINUES_VS_3BET = 0.35
# Teto para a defesa total do BB (3-bet + call) contra um raise.
MAX_BB_DEFENSE = 0.80

# Faixa de mãos marginais em torno do corte de um range, como fração de todas as mãos
# para cada lado, limitada a uma parte do tamanho do range (ranges pequenos têm faixa
# pequena). Dentro dela a frequência cai de 100% a 0% em passos de `MIX_STEP`.
MIX_BAND = 0.025
MIX_BAND_MAX_SHARE = 0.25
MIX_STEP = 0.25

_WEIGHTS = np.array([COMBO_COUNT[name] for name in HAND_CLASSES]) / TOTAL_COMBOS
_NUM_CLASSES = len(HAND_CLASSES)
_BLOCKER_SUITED = np.array([name.endswith("s") and name[0] in "AK" for name in HAND_CLASSES])


@dataclass(frozen=True)
class ReferenceSpot:
    """Frequências por ação (0..1 por classe) e tamanho sugerido de cada aposta, em bb."""

    actions: dict[str, np.ndarray]
    sizes: dict[str, float]


@dataclass(frozen=True)
class ReferenceTable:
    players: int
    stack_bb: float
    spots: dict[str, ReferenceSpot] = field(default_factory=dict)


def coverage(frequencies: np.ndarray) -> float:
    """Fração dos 1326 combos coberta por um range com frequências por classe."""
    return float(frequencies @ _WEIGHTS)


def _depth(stack_bb: float) -> float:
    """0 no stack de referência mais raso (25 bb), 1 no mais fundo (100 bb)."""
    return float(np.clip((stack_bb - 25.0) / 75.0, 0.0, 1.0))


def playability_bonus(stack_bb: float) -> np.ndarray:
    """Pontos de equity somados à nota de cada classe pelo que ela rende depois do flop."""
    depth = _depth(stack_bb)
    bonus = np.zeros(_NUM_CLASSES)
    for index, name in enumerate(HAND_CLASSES):
        high, low = RANK_INDEX[name[0]], RANK_INDEX[name[1]]
        if high == low:
            bonus[index] = PAIR_BONUS[0] + PAIR_BONUS[1] * depth
            continue
        gap = low - high - 1
        connected = CONNECTED_BONUS[gap] * (1 + depth) if gap < len(CONNECTED_BONUS) else 0.0
        if name[0] in "AK":
            connected *= HIGH_CARD_CONNECTED_FACTOR
        suited = SUITED_BONUS[0] + SUITED_BONUS[1] * depth if name[2] == "s" else 0.0
        bonus[index] = connected + suited
    return bonus


def equity_against(matrix: EquityMatrix, villain: np.ndarray) -> np.ndarray:
    """Equity de cada classe contra um range (frequência por classe), com bloqueio."""
    weight = matrix.combos @ villain
    share = (matrix.combos * matrix.equity) @ villain
    return np.divide(share, weight, out=np.zeros_like(share), where=weight > 0)


def top_fraction(
    scores: np.ndarray, fraction: float, allowed: np.ndarray | None = None
) -> np.ndarray:
    """As classes de maior nota (entre as permitidas) até cobrir `fraction` dos combos."""
    selected = np.zeros(_NUM_CLASSES)
    covered = 0.0
    for index in np.argsort(-scores, kind="stable"):
        if allowed is not None and not allowed[index]:
            continue
        # A classe entra se isso deixar o total mais perto do alvo.
        if covered + _WEIGHTS[index] / 2 > fraction:
            break
        selected[index] = 1.0
        covered += _WEIGHTS[index]
    return selected


def soft_top(scores: np.ndarray, fraction: float, allowed: np.ndarray | None = None) -> np.ndarray:
    """Como `top_fraction`, mas sem corte seco: as classes perto do corte entram em parte.

    A frequência cai de 100% a 0% ao longo de uma faixa centrada no corte, em passos de
    `MIX_STEP`, de modo que o total coberto continua perto de `fraction`.
    """
    selected = np.zeros(_NUM_CLASSES)
    if fraction <= 0:
        return selected
    band = min(MIX_BAND, MIX_BAND_MAX_SHARE * fraction)
    covered = 0.0
    for index in np.argsort(-scores, kind="stable"):
        if allowed is not None and not allowed[index]:
            continue
        middle = covered + _WEIGHTS[index] / 2
        if middle >= fraction + band:
            break
        share = (fraction + band - middle) / (2 * band)
        selected[index] = min(1.0, round(share / MIX_STEP) * MIX_STEP)
        covered += _WEIGHTS[index]
    return selected


def open_fraction(players: int, position_index: int) -> float:
    if players == 2:
        return HEADS_UP_OPEN_FRACTION
    return OPEN_FRACTION[players - 1 - position_index]


def open_scores(
    matrix: EquityMatrix, players: int, position_index: int, stack_bb: float
) -> np.ndarray:
    """Nota de cada classe para abrir o pote com raise naquela posição."""
    behind = players - 1 - position_index
    random_weight = HEADS_UP_RANDOM_WEIGHT if players == 2 else RANDOM_WEIGHT[behind]
    against_random = equity_against(matrix, np.ones(_NUM_CLASSES))
    against_strong = equity_against(matrix, top_fraction(against_random, STRONG_RANGE))
    mixed = random_weight * against_random + (1 - random_weight) * against_strong
    return mixed + playability_bonus(stack_bb)


def open_size(players: int, position: str, stack_bb: float) -> float:
    """Tamanho do raise de abertura, em bb."""
    small = stack_bb <= SHOVE_3BET_MAX_STACK
    if position == "SB" and players > 2:
        return 2.5 if small else 3.0
    return 2.0 if small else 2.2


def continue_fractions(
    players: int, hero: str, opener_fraction: float, stack_bb: float
) -> tuple[float, float, float]:
    """(3-bet por valor, 3-bet de blefe, call) como frações de todas as mãos."""
    shove = stack_bb <= SHOVE_3BET_MAX_STACK
    in_blinds = hero in ("SB", "BB")
    if shove:
        value = (0.33 if in_blinds else 0.28) * opener_fraction
        bluff = 0.0
    else:
        value = 0.11 * opener_fraction + 0.004
        bluff = value * (0.5 + 0.5 * _depth(stack_bb))

    if hero == "BB":
        # O BB já pôs 1 bb e fecha a ação: defende bem mais largo que os outros.
        defend = (0.20 if shove else 0.25) + 0.9 * opener_fraction
        call = max(0.0, min(MAX_BB_DEFENSE, defend) - value - bluff)
    elif hero == "SB":
        call = (0.04 if shove else 0.08) * opener_fraction
    else:
        positions = positions_for(players)
        behind = len(positions) - 1 - positions.index(hero)
        # Quanto mais perto do botão, mais vale pagar em posição.
        closeness = {2: 0.30, 3: 0.20}.get(behind, 0.14)
        call = (0.5 if shove else 1.0) * closeness * opener_fraction
    return value, bluff, call


def three_bet_size(players: int, hero: str, opener: str, stack_bb: float) -> float:
    """Tamanho total do 3-bet em bb: 3x o raise em posição, 4x fora de posição."""
    in_position = hero not in ("SB", "BB") or (hero == "BB" and opener == "SB" and players > 2)
    return round(open_size(players, opener, stack_bb) * (3.0 if in_position else 4.0), 1)


def response_to_open(
    matrix: EquityMatrix,
    players: int,
    hero: str,
    opener: str,
    opening: np.ndarray,
    stack_bb: float,
) -> ReferenceSpot:
    """3-bet, call ou fold do herói contra o raise de `opener` (range `opening`)."""
    shove = stack_bb <= SHOVE_3BET_MAX_STACK
    value_fraction, bluff_fraction, call_fraction = continue_fractions(
        players, hero, coverage(opening), stack_bb
    )
    against_open = equity_against(matrix, opening)
    if shove:
        # O all-in é pago só pela parte forte, mas ganha o pote quando o resto folda:
        # a equity contra o range inteiro de abertura ordena bem as mãos.
        value = soft_top(against_open, value_fraction)
    else:
        strong = top_fraction(against_open, CONTINUES_VS_3BET * coverage(opening), opening > 0)
        value = soft_top(equity_against(matrix, strong), value_fraction)

    playable = against_open + playability_bonus(stack_bb)
    # Tudo com que o herói continua (3-bet ou call), pela ordem de jogabilidade. O que
    # não é 3-bet por valor fica para call ou blefe.
    total = value_fraction + bluff_fraction + call_fraction
    continuing = np.maximum(soft_top(playable, total), value)
    room = continuing - value
    # Blefes saem do fundo do que continua, só com bloqueador; se faltarem mãos assim,
    # há menos blefes (em vez de blefar com lixo).
    candidates = (room > 0) & _BLOCKER_SUITED
    bluff = np.minimum(soft_top(-playable, bluff_fraction, allowed=candidates), room)

    three_bet = "allin" if shove else "raise"
    sizes = {} if shove else {"raise": three_bet_size(players, hero, opener, stack_bb)}
    return ReferenceSpot(actions={three_bet: value + bluff, "call": room - bluff}, sizes=sizes)


def build_table(matrix: EquityMatrix, players: int, stack_bb: float) -> ReferenceTable:
    """Todos os spots da mesa: 'open' de cada posição e a resposta de quem age depois."""
    positions = positions_for(players)
    table = ReferenceTable(players=players, stack_bb=stack_bb)
    for opener_index, opener in enumerate(positions[:-1]):
        scores = open_scores(matrix, players, opener_index, stack_bb)
        opening = soft_top(scores, open_fraction(players, opener_index))
        table.spots[spot_key(opener, OPEN)] = ReferenceSpot(
            actions={"raise": opening},
            sizes={"raise": open_size(players, opener, stack_bb)},
        )
        for hero in positions[opener_index + 1 :]:
            table.spots[spot_key(hero, f"vs_{opener}")] = response_to_open(
                matrix, players, hero, opener, opening, stack_bb
            )
    return table
