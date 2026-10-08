"""Ranges personalizados: validação, persistência (SQLAlchemy) e exportação/importação."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from numbers import Real
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.cards import HAND_CLASS_INDEX, HAND_CLASSES
from app.core.errors import UserInputError
from app.core.positions import OPEN, normalize_position, normalize_scenario
from app.models.tables import CustomRange

# Ordem em que as ações aparecem nas respostas; fold sempre por último.
ACTIONS = ("allin", "raise", "call", "fold")
FOLD = "fold"

EXPORT_FORMAT = "poker-range-helper/custom-ranges"
EXPORT_VERSION = 1
MAX_STACK_BB = 1000.0
MAX_NAME_LENGTH = 80
FREQUENCY_DECIMALS = 3


class CustomRangeError(UserInputError):
    """Range personalizado inválido. A mensagem vai para o usuário (em português)."""


class CustomRangeNotFoundError(LookupError):
    """Não existe range personalizado com o id pedido."""


@dataclass(frozen=True)
class CustomRangeData:
    """Um range personalizado já validado e normalizado."""

    name: str
    players: int
    stack_bb: float
    position: str
    scenario: str
    actions: dict[str, dict[str, float]]


def normalize_actions(actions: Mapping[str, Mapping[str, float]]) -> dict[str, dict[str, float]]:
    """Valida as frequências e completa as 169 classes; o que faltar para 100% vira fold."""
    unknown = sorted(name for name in actions if name not in HAND_CLASS_INDEX)
    if unknown:
        raise CustomRangeError(f"Classe de mão desconhecida: {', '.join(unknown[:5])}.")

    normalized: dict[str, dict[str, float]] = {}
    for hand in HAND_CLASSES:
        played: dict[str, float] = {}
        for action, frequency in actions.get(hand, {}).items():
            if action not in ACTIONS:
                raise CustomRangeError(
                    f"Ação inválida em {hand}: '{action}'. Use allin, raise, call ou fold."
                )
            if isinstance(frequency, bool) or not isinstance(frequency, Real):
                raise CustomRangeError(f"Frequência inválida em {hand}: use um número de 0 a 1.")
            if not 0 <= frequency <= 1:
                raise CustomRangeError(f"Frequência fora do intervalo em {hand}: use de 0 a 1.")
            if action != FOLD and frequency > 0:
                played[action] = round(float(frequency), FREQUENCY_DECIMALS)

        total = sum(played.values())
        if total > 1 + 1e-6:
            raise CustomRangeError(f"As frequências de {hand} somam mais de 100%.")
        ordered = {action: played[action] for action in ACTIONS if action in played}
        fold = round(1 - total, FREQUENCY_DECIMALS)
        if fold > 0:
            ordered[FOLD] = fold
        normalized[hand] = ordered
    return normalized


def default_name(position: str, scenario: str, stack_bb: float) -> str:
    situation = "open" if scenario == OPEN else f"vs {scenario.removeprefix('vs_')}"
    return f"{position} {situation} {stack_bb:g}bb"


def validate_custom_range(
    name: str,
    players: int,
    stack_bb: float,
    position: str,
    scenario: str,
    actions: Mapping[str, Mapping[str, float]],
) -> CustomRangeData:
    hero = normalize_position(players, position)
    canonical = normalize_scenario(players, hero, scenario)
    if not 0 < stack_bb <= MAX_STACK_BB:
        raise CustomRangeError(f"Stack inválido: use um valor entre 0 e {MAX_STACK_BB:g} bb.")
    stack = round(float(stack_bb), 2)
    label = name.strip() or default_name(hero, canonical, stack)
    if len(label) > MAX_NAME_LENGTH:
        raise CustomRangeError(f"O nome aceita no máximo {MAX_NAME_LENGTH} caracteres.")
    return CustomRangeData(
        name=label,
        players=players,
        stack_bb=stack,
        position=hero,
        scenario=canonical,
        actions=normalize_actions(actions),
    )


class CustomRangeService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def all(self) -> list[CustomRange]:
        query = select(CustomRange).order_by(
            CustomRange.players, CustomRange.stack_bb, CustomRange.id
        )
        return list(self._session.scalars(query))

    def get(self, range_id: int) -> CustomRange:
        record = self._session.get(CustomRange, range_id)
        if record is None:
            raise CustomRangeNotFoundError(f"Range personalizado {range_id} não encontrado.")
        return record

    def for_spot(self, players: int, position: str, scenario: str) -> list[CustomRange]:
        """Ranges salvos para a mesma mesa, posição e cenário (um por stack)."""
        query = select(CustomRange).where(
            CustomRange.players == players,
            CustomRange.position == position,
            CustomRange.scenario == scenario,
        )
        return list(self._session.scalars(query))

    def _upsert(self, data: CustomRangeData) -> tuple[CustomRange, bool]:
        query = select(CustomRange).where(
            CustomRange.players == data.players,
            CustomRange.stack_bb == data.stack_bb,
            CustomRange.position == data.position,
            CustomRange.scenario == data.scenario,
        )
        record = self._session.scalars(query).first()
        created = record is None
        if record is None:
            record = CustomRange(
                players=data.players,
                stack_bb=data.stack_bb,
                position=data.position,
                scenario=data.scenario,
            )
            self._session.add(record)
        record.name = data.name
        record.actions = data.actions
        return record, created

    def save(self, data: CustomRangeData) -> tuple[CustomRange, bool]:
        """Grava o range do spot, substituindo o que já existir; devolve (range, criado?)."""
        record, created = self._upsert(data)
        self._session.commit()
        self._session.refresh(record)
        return record, created

    def delete(self, range_id: int) -> None:
        self._session.delete(self.get(range_id))
        self._session.commit()

    def export_document(self) -> dict[str, Any]:
        return {
            "format": EXPORT_FORMAT,
            "version": EXPORT_VERSION,
            "exported_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ranges": [
                {
                    "name": record.name,
                    "players": record.players,
                    "stack_bb": record.stack_bb,
                    "position": record.position,
                    "scenario": record.scenario,
                    "actions": record.actions,
                }
                for record in self.all()
            ],
        }

    def import_ranges(self, ranges: Iterable[CustomRangeData]) -> tuple[int, int]:
        """Grava todos os ranges numa transação só; devolve (criados, atualizados)."""
        created = updated = 0
        for data in ranges:
            _, was_created = self._upsert(data)
            # O flush faz dois ranges do mesmo spot no arquivo virarem um update.
            self._session.flush()
            created += was_created
            updated += not was_created
        self._session.commit()
        return created, updated
