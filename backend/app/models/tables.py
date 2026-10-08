"""Tabelas do banco (SQLAlchemy)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class CustomRange(Base):
    """Range que o usuário pintou para um spot; há no máximo um por spot."""

    __tablename__ = "custom_ranges"
    __table_args__ = (
        UniqueConstraint("players", "stack_bb", "position", "scenario", name="uq_custom_spot"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    players: Mapped[int]
    stack_bb: Mapped[float]
    position: Mapped[str] = mapped_column(String(8))
    scenario: Mapped[str] = mapped_column(String(16))
    # Classe de mão -> {ação: frequência}, com as 169 classes.
    actions: Mapped[dict[str, dict[str, float]]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)
