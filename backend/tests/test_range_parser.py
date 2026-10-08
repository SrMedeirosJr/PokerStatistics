import random

import pytest

from app.core.cards import HAND_CLASS_INDEX, HAND_CLASSES
from app.core.range_parser import (
    RangeParseError,
    parse_range,
    parse_weighted_range,
    serialize_range,
    serialize_weighted_range,
)

ALL_PAIRS = ["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44", "33", "22"]


def test_pair_plus_covers_all_thirteen_pairs() -> None:
    assert parse_range("22+") == ALL_PAIRS
    assert len(parse_range("22+")) == 13


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("AA,KK", ["AA", "KK"]),
        ("TT+", ["AA", "KK", "QQ", "JJ", "TT"]),
        ("AA-22", ALL_PAIRS),
        ("JJ-77", ["JJ", "TT", "99", "88", "77"]),
        ("77-JJ", ["JJ", "TT", "99", "88", "77"]),
        ("KTo+", ["KQo", "KJo", "KTo"]),
        ("AKs", ["AKs"]),
        ("AK", ["AKs", "AKo"]),
        ("A5s-A2s", ["A5s", "A4s", "A3s", "A2s"]),
        ("A2s-A5s", ["A5s", "A4s", "A3s", "A2s"]),
        ("T9s-65s", ["T9s", "98s", "87s", "76s", "65s"]),
        ("J9o-86o", ["J9o", "T8o", "97o", "86o"]),
        (" aa , kk ", ["AA", "KK"]),
        ("9Ks", ["K9s"]),
        ("AA KK;QQ", ["AA", "KK", "QQ"]),
        ("", []),
    ],
)
def test_parse_range(text: str, expected: list[str]) -> None:
    assert parse_range(text) == expected


def test_suited_plus_runs_up_to_the_top_kicker() -> None:
    assert parse_range("A2s+") == [f"A{kicker}s" for kicker in "KQJT98765432"]
    assert len(parse_range("A2+")) == 24


def test_result_follows_grid_order_and_has_no_duplicates() -> None:
    classes = parse_range("KTo+,22+,AKs,AA,AKs")

    assert classes == sorted(set(classes), key=HAND_CLASS_INDEX.__getitem__)


@pytest.mark.parametrize(
    "text",
    ["XX", "AKx", "AKs+-", "A2s-K5s", "AKs-AQo", "AA-AKs", "22s", "AKs-", "A", "AKQ", "22++"],
)
def test_invalid_ranges_raise(text: str) -> None:
    with pytest.raises(RangeParseError):
        parse_range(text)


@pytest.mark.parametrize(
    "text",
    [
        "22+",
        "A2s+",
        "KTo+",
        "KK+",
        "JJ-77",
        "AA,QQ-TT,22",
        "A5s-A2s",
        "22+,A2s+,K9s+,Q9s+,JTs,A2o+,KTo+",
        "TT+,AQs+,K5s-K3s,76s,AKo,Q9o",
    ],
)
def test_canonical_strings_round_trip(text: str) -> None:
    assert serialize_range(parse_range(text)) == text


def test_serialize_compacts_equivalent_notations() -> None:
    assert serialize_range(parse_range("AA,KK")) == "KK+"
    assert serialize_range(parse_range("T9s-65s")) == "T9s,98s,87s,76s,65s"
    assert serialize_range(parse_range("AK")) == "AKs,AKo"


def test_serialize_then_parse_round_trips_for_random_subsets() -> None:
    rng = random.Random(1234)
    for _ in range(300):
        subset = rng.sample(HAND_CLASSES, rng.randint(0, 169))
        expected = sorted(subset, key=HAND_CLASS_INDEX.__getitem__)

        assert parse_range(serialize_range(subset)) == expected


def test_full_and_empty_ranges() -> None:
    full = serialize_range(HAND_CLASSES)

    assert full.startswith("22+,A2s+,K2s+")
    assert full.endswith("42o+,32o")
    assert parse_range(full) == list(HAND_CLASSES)
    assert serialize_range([]) == ""


def test_serialize_rejects_unknown_classes() -> None:
    with pytest.raises(RangeParseError, match="desconhecida"):
        serialize_range(["AA", "ZZ"])


def test_weighted_range_parsing() -> None:
    assert parse_weighted_range("AA,K9o:0.4") == {"AA": 1.0, "K9o": 0.4}
    assert parse_weighted_range("TT+:0.5") == dict.fromkeys(["AA", "KK", "QQ", "JJ", "TT"], 0.5)
    assert parse_weighted_range("AA,KK:0") == {"AA": 1.0}
    assert parse_weighted_range("AA:0.3,AA:0.7") == {"AA": 0.7}


@pytest.mark.parametrize("text", ["AA:1.5", "AA:-0.1", "AA:abc", "AA:"])
def test_invalid_weights_raise(text: str) -> None:
    with pytest.raises(RangeParseError, match="Peso"):
        parse_weighted_range(text)


def test_weighted_round_trip() -> None:
    weights = {"AA": 1.0, "KK": 1.0, "QQ": 1.0, "A5s": 0.25, "A4s": 0.25, "K9o": 0.4, "72o": 0.0}
    text = serialize_weighted_range(weights)

    assert text == "QQ+,K9o:0.4,A5s-A4s:0.25"
    assert parse_weighted_range(text) == {
        "AA": 1.0,
        "KK": 1.0,
        "QQ": 1.0,
        "A5s": 0.25,
        "A4s": 0.25,
        "K9o": 0.4,
    }


def test_weighted_round_trip_for_random_ranges() -> None:
    rng = random.Random(99)
    for _ in range(100):
        subset = rng.sample(HAND_CLASSES, rng.randint(1, 169))
        weights = {name: rng.choice([1.0, 0.75, 0.5, 0.125]) for name in subset}
        expected = dict(sorted(weights.items(), key=lambda item: HAND_CLASS_INDEX[item[0]]))

        assert parse_weighted_range(serialize_weighted_range(weights)) == expected
