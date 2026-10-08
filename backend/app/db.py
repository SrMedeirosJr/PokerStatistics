"""Banco de dados (SQLite por padrão) dos ranges personalizados."""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> Engine:
    """Cria o engine e as tabelas que ainda não existirem."""
    from app.models import tables  # noqa: F401  (registra os modelos em Base.metadata)

    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args)
    Base.metadata.create_all(engine)
    return engine
