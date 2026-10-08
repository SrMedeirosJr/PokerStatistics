"""Dependências compartilhadas pelas rotas."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.services.custom_ranges import CustomRangeService
from app.services.range_store import RangeStore


def get_store(request: Request) -> RangeStore:
    return request.app.state.range_store


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as session:
        yield session


def get_custom_ranges(session: Annotated[Session, Depends(get_session)]) -> CustomRangeService:
    return CustomRangeService(session)


Store = Annotated[RangeStore, Depends(get_store)]
CustomRanges = Annotated[CustomRangeService, Depends(get_custom_ranges)]
