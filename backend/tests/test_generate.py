import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.core.cards import HAND_CLASSES
from app.solver.equity_matrix import EquityMatrix
from app.solver.generate import (
    action_frequencies,
    dump_document,
    format_stack,
    generate,
    main,
    parse_players,
    parse_stacks,
    range_file_name,
    solution_to_document,
)
from app.solver.pushfold import GameConfig, solve


def test_parse_players() -> None:
    assert parse_players("2-9") == [2, 3, 4, 5, 6, 7, 8, 9]
    assert parse_players("8") == [8]
    assert parse_players("9, 6,8") == [6, 8, 9]
    assert parse_players("2-3,6") == [2, 3, 6]


@pytest.mark.parametrize("text", ["1-3", "10", "abc", ""])
def test_parse_players_rejects_invalid_values(text: str) -> None:
    with pytest.raises(ValueError):
        parse_players(text)


def test_parse_stacks_and_names() -> None:
    assert parse_stacks("10,3,5,3") == [3.0, 5.0, 10.0]
    assert parse_stacks("2.5") == [2.5]
    assert format_stack(6.0) == "6"
    assert format_stack(2.5) == "2.5"
    assert range_file_name(8, 6.0) == "mtt_8max_6bb.json"
    assert range_file_name(2, 2.5) == "mtt_2max_2.5bb.json"
    with pytest.raises(ValueError):
        parse_stacks(" , ")


def test_action_frequencies_format() -> None:
    assert action_frequencies(1.0, "allin") == {"allin": 1.0}
    assert action_frequencies(0.0, "allin") == {"fold": 1.0}
    assert action_frequencies(0.4, "call") == {"call": 0.4, "fold": 0.6}
    assert action_frequencies(0.12345, "allin") == {"allin": 0.123, "fold": 0.877}


def test_numerical_residue_is_treated_as_pure() -> None:
    assert action_frequencies(0.9993, "call") == {"call": 1.0}
    assert action_frequencies(0.0004, "call") == {"fold": 1.0}
    assert action_frequencies(0.98, "call") == {"call": 0.98, "fold": 0.02}


def test_document_follows_the_plan_format(equity_matrix: EquityMatrix) -> None:
    solution = solve(equity_matrix, GameConfig(players=3, stack_bb=6))
    document = solution_to_document(solution, datetime(2026, 10, 8, 17, 0, tzinfo=UTC))

    assert document["meta"] == {
        "format": "mtt",
        "players": 3,
        "stack_bb": 6,
        "ante_bb": 0.125,
        "model": "chipev-nash-pushfold-v1",
        "generated_at": "2026-10-08T17:00:00Z",
    }
    assert set(document["spots"]) == {"BTN_open", "SB_open", "SB_vs_BTN", "BB_vs_BTN", "BB_vs_SB"}
    assert list(document["spots"]["BTN_open"]["actions"]) == list(HAND_CLASSES)
    assert document["spots"]["BTN_open"]["actions"]["AA"] == {"allin": 1.0}
    assert document["spots"]["BB_vs_BTN"]["actions"]["AA"] == {"call": 1.0}
    assert document["spots"]["BB_vs_BTN"]["actions"]["72o"] == {"fold": 1.0}
    assert document["spots"]["BTN_open"]["solver"]["converged"] is True
    assert json.loads(dump_document(document)) == document


def test_generate_writes_one_file_per_table_and_stack(tmp_path: Path) -> None:
    paths = generate(players=[2, 3], stacks=[5.0, 8.0], output_dir=tmp_path)

    assert sorted(path.name for path in paths) == [
        "mtt_2max_5bb.json",
        "mtt_2max_8bb.json",
        "mtt_3max_5bb.json",
        "mtt_3max_8bb.json",
    ]
    document = json.loads((tmp_path / "mtt_2max_5bb.json").read_text(encoding="utf-8"))
    assert document["meta"]["players"] == 2
    assert document["meta"]["stack_bb"] == 5
    assert set(document["spots"]) == {"SB_open", "BB_vs_SB"}


def test_cli_generates_files(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = main(
        ["--players", "2", "--stacks", "4", "--output-dir", str(tmp_path), "--workers", "1"]
    )

    assert code == 0
    assert (tmp_path / "mtt_2max_4bb.json").exists()
    assert "mtt_2max_4bb.json" in capsys.readouterr().out


def test_cli_fails_clearly_without_the_equity_matrix(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(["--players", "2", "--stacks", "4", "--matrix", str(tmp_path / "missing.npz")])

    assert code == 1
    assert "python -m app.solver.equity_matrix" in capsys.readouterr().err
