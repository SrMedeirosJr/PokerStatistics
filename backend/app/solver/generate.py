"""CLI que resolve os spots push/fold e grava um JSON por (jogadores, stack).

Uso:
    python -m app.solver.generate --players 2-9 --stacks 3,4,5,6,7,8,10,12,15,20 --ante 0.125
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Iterable
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import RANGES_DIR
from app.core.cards import HAND_CLASSES
from app.core.positions import MAX_PLAYERS, MIN_PLAYERS, OPEN
from app.solver.equity_matrix import DEFAULT_PATH, EquityMatrix, load_equity_matrix
from app.solver.pushfold import MODEL, GameConfig, Solution, SolverSettings, solve

DEFAULT_PLAYERS = f"{MIN_PLAYERS}-{MAX_PLAYERS}"
DEFAULT_STACKS = "3,4,5,6,7,8,10,12,15,20"
DEFAULT_ANTE = 0.125
FORMAT = "mtt"

FREQUENCY_DECIMALS = 3
# Frequências a menos de 0,5% de uma ação pura são resíduo numérico do fictitious play.
PURE_THRESHOLD = 0.005

Task = tuple[int, float, float, SolverSettings, Path]


def parse_players(text: str) -> list[int]:
    """Aceita '8', '6,8,9' ou um intervalo como '2-9'."""
    players: set[int] = set()
    for part in text.split(","):
        first, _, last = part.strip().partition("-")
        players.update(range(int(first), int(last or first) + 1))
    invalid = [count for count in players if not MIN_PLAYERS <= count <= MAX_PLAYERS]
    if invalid or not players:
        raise ValueError(f"Jogadores inválidos: '{text}'. Use de {MIN_PLAYERS} a {MAX_PLAYERS}.")
    return sorted(players)


def parse_stacks(text: str) -> list[float]:
    stacks = sorted({float(part) for part in text.split(",") if part.strip()})
    if not stacks:
        raise ValueError("Informe pelo menos um stack.")
    return stacks


def format_stack(stack: float) -> str:
    """6.0 -> '6'; 2.5 -> '2.5'."""
    return f"{stack:g}"


def range_file_name(players: int, stack: float) -> str:
    return f"{FORMAT}_{players}max_{format_stack(stack)}bb.json"


def action_frequencies(frequency: float, action: str) -> dict[str, float]:
    """Formato do JSON: {'allin': 1.0}, {'fold': 1.0} ou {'call': 0.4, 'fold': 0.6}."""
    if frequency >= 1 - PURE_THRESHOLD:
        return {action: 1.0}
    if frequency <= PURE_THRESHOLD:
        return {"fold": 1.0}
    value = round(frequency, FREQUENCY_DECIMALS)
    return {action: value, "fold": round(1 - value, FREQUENCY_DECIMALS)}


def solution_to_document(solution: Solution, generated_at: datetime) -> dict[str, Any]:
    config = solution.config
    stack = config.stack_bb
    spots: dict[str, Any] = {}
    for key, frequencies in solution.spots.items():
        action = "allin" if key.endswith(f"_{OPEN}") else "call"
        report = solution.reports[key]
        spots[key] = {
            "actions": {
                name: action_frequencies(float(frequency), action)
                for name, frequency in zip(HAND_CLASSES, frequencies, strict=True)
            },
            "solver": {
                "iterations": report.iterations,
                "converged": report.converged,
                "exploitability_bb": round(report.exploitability_bb, 6),
            },
        }
    return {
        "meta": {
            "format": FORMAT,
            "players": config.players,
            "stack_bb": int(stack) if stack == int(stack) else stack,
            "ante_bb": config.ante_bb,
            "model": MODEL,
            "generated_at": generated_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "spots": spots,
    }


def dump_document(document: dict[str, Any]) -> str:
    """JSON com um spot por linha: compacto, mas ainda legível em diffs."""
    spots = ",\n".join(
        f"    {json.dumps(key)}: {json.dumps(spot)}" for key, spot in document["spots"].items()
    )
    return f'{{\n  "meta": {json.dumps(document["meta"])},\n  "spots": {{\n{spots}\n  }}\n}}\n'


_matrix_cache: dict[Path, EquityMatrix] = {}


def _solve_task(task: Task) -> Solution:
    players, stack, ante, settings, matrix_path = task
    if matrix_path not in _matrix_cache:
        _matrix_cache[matrix_path] = load_equity_matrix(matrix_path)
    return solve(_matrix_cache[matrix_path], GameConfig(players, stack, ante), settings)


def generate(
    players: Iterable[int],
    stacks: Iterable[float],
    ante: float = DEFAULT_ANTE,
    output_dir: Path = RANGES_DIR,
    matrix_path: Path = DEFAULT_PATH,
    settings: SolverSettings | None = None,
    workers: int = 1,
    verbose: bool = False,
) -> list[Path]:
    """Resolve cada (jogadores, stack) e grava os arquivos; devolve os caminhos gravados."""
    settings = settings or SolverSettings()
    load_equity_matrix(matrix_path)  # falha cedo, com instrução, se a matriz não existir
    tasks: list[Task] = [
        (count, stack, ante, settings, matrix_path) for count in players for stack in stacks
    ]
    generated_at = datetime.now(UTC)
    output_dir.mkdir(parents=True, exist_ok=True)

    def write_all(solutions: Iterable[Solution]) -> list[Path]:
        paths: list[Path] = []
        for solution in solutions:
            config = solution.config
            path = output_dir / range_file_name(config.players, config.stack_bb)
            path.write_text(
                dump_document(solution_to_document(solution, generated_at)), encoding="utf-8"
            )
            paths.append(path)
            if verbose:
                reports = solution.reports.values()
                pending = sum(not report.converged for report in reports)
                print(
                    f"{path.name:22s} {len(solution.spots):3d} spots | "
                    f"até {max(report.iterations for report in reports):6d} iterações | "
                    f"exploitability máx. {max(r.exploitability_bb for r in reports):.5f} bb"
                    + (f" | {pending} spot(s) SEM convergir" if pending else ""),
                    flush=True,
                )
        return paths

    if workers <= 1:
        return write_all(map(_solve_task, tasks))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return write_all(pool.map(_solve_task, tasks))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Gera os ranges push/fold (Nash aproximado).")
    parser.add_argument("--players", default=DEFAULT_PLAYERS, help="ex.: 2-9, 6,8,9 ou 8")
    parser.add_argument("--stacks", default=DEFAULT_STACKS, help="stacks em bb, separados por ,")
    parser.add_argument("--ante", type=float, default=DEFAULT_ANTE, help="ante por jogador, em bb")
    parser.add_argument("--output-dir", type=Path, default=RANGES_DIR)
    parser.add_argument("--matrix", type=Path, default=DEFAULT_PATH, help="matriz de equity .npz")
    parser.add_argument("--max-iterations", type=int, default=SolverSettings.max_iterations)
    parser.add_argument("--tolerance", type=float, default=SolverSettings.tolerance)
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 1, help="processos")
    args = parser.parse_args(argv)

    try:
        players = parse_players(args.players)
        stacks = parse_stacks(args.stacks)
    except ValueError as error:
        parser.error(str(error))
    settings = SolverSettings(max_iterations=args.max_iterations, tolerance=args.tolerance)

    started = time.monotonic()
    try:
        paths = generate(
            players, stacks, args.ante, args.output_dir, args.matrix, settings, args.workers, True
        )
    except FileNotFoundError as error:
        print(error, file=sys.stderr)
        return 1
    print(f"{len(paths)} arquivo(s) em {args.output_dir} ({time.monotonic() - started:.0f}s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
