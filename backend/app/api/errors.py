"""Respostas de erro da API: sempre `{"detail": "<mensagem em português>"}`."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.errors import UserInputError

_REQUEST_PARTS = {"query", "body", "path", "header", "cookie"}

# Tipos de erro do Pydantic -> mensagem; {field} e as chaves de `ctx` são preenchidos.
_MESSAGES: dict[str, str] = {
    "missing": "O campo '{field}' é obrigatório.",
    "int_parsing": "O campo '{field}' deve ser um número inteiro.",
    "int_type": "O campo '{field}' deve ser um número inteiro.",
    "int_from_float": "O campo '{field}' deve ser um número inteiro.",
    "float_parsing": "O campo '{field}' deve ser um número.",
    "float_type": "O campo '{field}' deve ser um número.",
    "string_type": "O campo '{field}' deve ser um texto.",
    "list_type": "O campo '{field}' deve ser uma lista.",
    "greater_than": "O campo '{field}' deve ser maior que {gt}.",
    "greater_than_equal": "O campo '{field}' deve ser maior ou igual a {ge}.",
    "less_than": "O campo '{field}' deve ser menor que {lt}.",
    "less_than_equal": "O campo '{field}' deve ser menor ou igual a {le}.",
    "json_invalid": "O corpo da requisição não é um JSON válido.",
}
_FALLBACK = "O campo '{field}' tem um valor inválido."


def _field_name(location: Sequence[Any]) -> str:
    parts = [part for part in location if part not in _REQUEST_PARTS] or list(location)
    name = ""
    for part in parts:
        if isinstance(part, int):
            name += f"[{part}]"
        else:
            name += f".{part}" if name else str(part)
    return name


def translate_validation_error(error: Mapping[str, Any]) -> str:
    """Mensagem em português para um item de `RequestValidationError.errors()`."""
    template = _MESSAGES.get(error.get("type", ""), _FALLBACK)
    values = {**error.get("ctx", {}), "field": _field_name(error.get("loc", ()))}
    try:
        return template.format(**values)
    except KeyError:
        return _FALLBACK.format(**values)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        messages = dict.fromkeys(translate_validation_error(item) for item in error.errors())
        return JSONResponse(status_code=422, content={"detail": " ".join(messages)})

    @app.exception_handler(UserInputError)
    async def handle_user_input_error(_: Request, error: UserInputError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(error)})
