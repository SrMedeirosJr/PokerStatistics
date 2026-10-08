from app.equity.evaluator import BACKEND, encode, strength


def rank(*cards: str) -> int:
    return strength([encode(card) for card in cards])


def test_backend_is_one_of_the_supported_libraries() -> None:
    assert BACKEND in {"eval7", "phevaluator"}


def test_hand_categories_are_ordered() -> None:
    ladder = [
        rank("As", "Kd", "9c", "7h", "4s", "3d", "2c"),  # carta alta
        rank("As", "Ad", "9c", "7h", "4s", "3d", "2c"),  # par
        rank("As", "Ad", "9c", "9h", "4s", "3d", "2c"),  # dois pares
        rank("As", "Ad", "Ac", "7h", "4s", "3d", "2c"),  # trinca
        rank("5s", "4d", "3c", "2h", "As", "Kd", "9c"),  # sequência (roda)
        rank("As", "Js", "9s", "7s", "4s", "3d", "2c"),  # flush
        rank("As", "Ad", "Ac", "7h", "7s", "3d", "2c"),  # full house
        rank("As", "Ad", "Ac", "Ah", "4s", "3d", "2c"),  # quadra
        rank("9s", "8s", "7s", "6s", "5s", "3d", "2c"),  # straight flush
        rank("As", "Ks", "Qs", "Js", "Ts", "3d", "2c"),  # royal flush
    ]

    assert ladder == sorted(ladder)
    assert len(set(ladder)) == len(ladder)


def test_kickers_break_ties_and_suits_do_not() -> None:
    assert rank("As", "Kd", "Ac", "7h", "4s", "3d", "2c") > rank(
        "Ah", "Qd", "Ac", "7h", "4s", "3d", "2c"
    )
    assert rank("As", "Kd", "9c", "7h", "4s", "3d", "2c") == rank(
        "Ah", "Kc", "9c", "7h", "4s", "3d", "2c"
    )


def test_best_five_of_seven_are_used() -> None:
    # O board já é um royal flush: as cartas fechadas não mudam nada.
    board = ("As", "Ks", "Qs", "Js", "Ts")

    assert rank("2c", "2d", *board) == rank("3h", "4h", *board)
