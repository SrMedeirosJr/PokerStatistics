"""Erro base para entradas inválidas do usuário."""

from __future__ import annotations


class UserInputError(ValueError):
    """Entrada inválida. A mensagem é exibida ao usuário, então fica em português."""
