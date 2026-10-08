import pytest

from app.core.cards import (
    COMBO_COUNT,
    COMBOS_BY_CLASS,
    DECK,
    HAND_CLASS_INDEX,
    HAND_CLASSES,
    TOTAL_COMBOS,
    HandParseError,
    hand_class_at,
    normalize_hand,
    parse_card,
    parse_hand,
)


def test_there_are_169_classes_and_1326_combos() -> None:
    assert len(HAND_CLASSES) == 169
    assert len(set(HAND_CLASSES)) == 169
    assert TOTAL_COMBOS == 1326


def test_class_counts_by_type() -> None:
    pairs = [name for name in HAND_CLASSES if len(name) == 2]
    suited = [name for name in HAND_CLASSES if name.endswith("s")]
    offsuit = [name for name in HAND_CLASSES if name.endswith("o")]

    assert (len(pairs), len(suited), len(offsuit)) == (13, 78, 78)
    assert {COMBO_COUNT[name] for name in pairs} == {6}
    assert {COMBO_COUNT[name] for name in suited} == {4}
    assert {COMBO_COUNT[name] for name in offsuit} == {12}


def test_combos_cover_every_two_card_hand_exactly_once() -> None:
    combos = [frozenset(combo) for name in HAND_CLASSES for combo in COMBOS_BY_CLASS[name]]

    assert len(combos) == 1326
    assert len(set(combos)) == 1326
    assert all(len(combo) == 2 and combo <= set(DECK) for combo in combos)


def test_combos_match_their_class() -> None:
    assert set(COMBOS_BY_CLASS["AKs"]) == {("As", "Ks"), ("Ah", "Kh"), ("Ad", "Kd"), ("Ac", "Kc")}
    assert ("Ah", "Kd") in COMBOS_BY_CLASS["AKo"]
    assert ("Ah", "Kh") not in COMBOS_BY_CLASS["AKo"]
    assert ("9s", "9h") in COMBOS_BY_CLASS["99"]


def test_grid_order_follows_industry_layout() -> None:
    assert HAND_CLASSES[0] == "AA"
    assert HAND_CLASSES[1] == "AKs"
    assert HAND_CLASSES[13] == "AKo"
    assert HAND_CLASSES[168] == "22"
    assert hand_class_at(0, 12) == "A2s"
    assert hand_class_at(12, 0) == "A2o"
    assert hand_class_at(4, 4) == "TT"
    assert HAND_CLASS_INDEX["K9o"] == 5 * 13 + 1


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("K9o", "K9o"),
        ("k9o", "K9o"),
        ("K9O", "K9o"),
        ("9Ko", "K9o"),
        ("aks", "AKs"),
        ("Kh9d", "K9o"),
        ("Kh9h", "K9s"),
        ("9s9d", "99"),
        ("99", "99"),
        ("9dKh", "K9o"),
        ("KH9D", "K9o"),
        ("  kh 9d ", "K9o"),
        ("10h9h", "T9s"),
        ("K10o", "KTo"),
        ("K♥9♦", "K9o"),
        ("A♠K♠", "AKs"),
    ],
)
def test_normalize_hand(text: str, expected: str) -> None:
    assert normalize_hand(text) == expected


def test_missing_suited_or_offsuit_suffix_asks_for_it() -> None:
    with pytest.raises(HandParseError) as error:
        normalize_hand("K9")

    assert "K9s" in str(error.value)
    assert "K9o" in str(error.value)


def test_repeated_card_is_rejected() -> None:
    with pytest.raises(HandParseError, match="Carta repetida"):
        normalize_hand("KhKh")


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("X9o", "Rank inválido"),
        ("1Ko", "Rank inválido"),
        ("Kx9d", "Naipe inválido"),
        ("Kh9z", "Naipe inválido"),
        ("K9x", "Sufixo inválido"),
        ("99s", "Pares não têm sufixo"),
        ("99o", "Pares não têm sufixo"),
        ("", "Informe uma mão"),
        ("   ", "Informe uma mão"),
        ("K", "Mão inválida"),
        ("AKQJ5", "Mão inválida"),
    ],
)
def test_invalid_hands_raise_portuguese_errors(text: str, message: str) -> None:
    with pytest.raises(HandParseError, match=message):
        normalize_hand(text)


def test_parse_hand_keeps_specific_cards_ordered_by_rank() -> None:
    assert parse_hand("9dKh").cards == ("Kh", "9d")
    assert parse_hand("9d9s").cards == ("9s", "9d")
    assert parse_hand("K9o").cards is None
    assert parse_hand("9dKh").hand_class == "K9o"


def test_parse_card() -> None:
    assert parse_card("ah") == "Ah"
    assert parse_card("10D") == "Td"
    assert parse_card("K♣") == "Kc"
    with pytest.raises(HandParseError, match="Carta inválida"):
        parse_card("Ahh")
    with pytest.raises(HandParseError, match="Naipe inválido"):
        parse_card("Ax")
