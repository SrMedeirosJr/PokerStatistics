"""CLI que grava as tabelas de referência (stack fundo) em data/reference.

Uso:
    python -m app.reference.generate
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import REFERENCE_DIR
from app.core.cards import HAND_CLASSES
from app.reference.model import MODEL, REFERENCE_STACKS, ReferenceTable, build_table
from app.solver.equity_matrix import DEFAULT_PATH, EquityMatrix, load_equity_matrix
from app.solver.generate import DEFAULT_PLAYERS, dump_document, parse_players, parse_stacks

FORMAT = "ref"
# Ordem das ações em cada mão; fold sempre por último.
ACTION_ORDER = ("allin", "raise", "call")


def reference_file_name(players: int, stack: float) -> str:
    return f"{FORMAT}_{players}max_{stack:g}bb.json"


def table_to_document(table: ReferenceTable, generated_at: datetime) -> dict[str, Any]:
    spots: dict[str, Any] = {}
    for key, spot in table.spots.items():
        actions: dict[str, dict[str, float]] = {}
        for index, name in enumerate(HAND_CLASSES):
            played = {
                action: round(float(spot.actions[action][index]), 3)
                for action in ACTION_ORDER
                if action in spot.actions and spot.actions[action][index] > 0
            }
            fold = round(1 - sum(played.values()), 3)
            actions[name] = {**played, "fold": fold} if fold > 0 else played
        spots[key] = {"actions": actions, "sizes": spot.sizes}
    stack = table.stack_bb
    return {
        "meta": {
            "format": FORMAT,
            "players": table.players,
            "stack_bb": int(stack) if stack == int(stack) else stack,
            "model": MODEL,
            "generated_at": generated_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "spots": spots,
    }


def generate(
    matrix: EquityMatrix,
    players: list[int],
    stacks: list[float],
    output_dir: Path = REFERENCE_DIR,
) -> list[Path]:
    """Grava um arquivo por (jogadores, stack); devolve os caminhos gravados."""
    generated_at = datetime.now(UTC)
    output_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for count in players:
        for stack in stacks:
            document = table_to_document(build_table(matrix, count, stack), generated_at)
            path = output_dir / reference_file_name(count, stack)
            path.write_text(dump_document(document), encoding="utf-8")
            paths.append(path)
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Gera as tabelas de referência (heurística) para stacks fundos."
    )
    parser.add_argument("--players", default=DEFAULT_PLAYERS, help="ex.: 2-9, 6,8,9 ou 8")
    parser.add_argument(
        "--stacks",
        default=",".join(f"{stack:g}" for stack in REFERENCE_STACKS),
        help="stacks em bb, separados por ,",
    )
    parser.add_argument("--output-dir", type=Path, default=REFERENCE_DIR)
    parser.add_argument("--matrix", type=Path, default=DEFAULT_PATH, help="matriz de equity .npz")
    args = parser.parse_args(argv)

    try:
        players = parse_players(args.players)
        stacks = parse_stacks(args.stacks)
        matrix = load_equity_matrix(args.matrix)
    except ValueError as error:
        parser.error(str(error))
    except FileNotFoundError as error:
        print(error, file=sys.stderr)
        return 1

    paths = generate(matrix, players, stacks, args.output_dir)
    print(f"{len(paths)} arquivo(s) de referência em {args.output_dir}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
