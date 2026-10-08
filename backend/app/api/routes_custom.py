from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.api.deps import CustomRanges
from app.core.errors import UserInputError
from app.models.schemas import (
    CustomRangeIn,
    CustomRangeOut,
    CustomRangesDocument,
    ImportResult,
)
from app.models.tables import CustomRange
from app.services.custom_ranges import (
    EXPORT_FORMAT,
    EXPORT_VERSION,
    CustomRangeData,
    CustomRangeError,
    validate_custom_range,
)
from app.services.spots import custom_spot_range

router = APIRouter(prefix="/api/custom-ranges", tags=["custom-ranges"])


def _validated(body: CustomRangeIn) -> CustomRangeData:
    return validate_custom_range(
        body.name, body.players, body.stack_bb, body.position, body.scenario, body.actions
    )


def _output(record: CustomRange) -> CustomRangeOut:
    spot = custom_spot_range(record)
    return CustomRangeOut(
        id=record.id,
        name=record.name,
        players=record.players,
        stack_bb=record.stack_bb,
        position=record.position,
        scenario=record.scenario,
        actions=record.actions,
        spot_id=spot.spot_id,
        range_pct=spot.range_pct,
        combos=spot.combos,
        updated_at=record.updated_at,
    )


@router.get("", response_model=list[CustomRangeOut])
def list_custom_ranges(customs: CustomRanges) -> list[CustomRangeOut]:
    return [_output(record) for record in customs.all()]


@router.post("", response_model=CustomRangeOut)
def save_custom_range(
    body: CustomRangeIn, customs: CustomRanges, response: Response
) -> CustomRangeOut:
    """Grava o range do spot; se já existir um para o mesmo spot, substitui."""
    record, created = customs.save(_validated(body))
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _output(record)


@router.get("/export", response_model=CustomRangesDocument)
def export_custom_ranges(customs: CustomRanges, response: Response) -> CustomRangesDocument:
    """Todos os ranges personalizados num único JSON, pronto para baixar."""
    response.headers["Content-Disposition"] = 'attachment; filename="ranges-personalizados.json"'
    return CustomRangesDocument.model_validate(customs.export_document())


@router.post("/import", response_model=ImportResult)
def import_custom_ranges(document: CustomRangesDocument, customs: CustomRanges) -> ImportResult:
    """Importa um JSON exportado; ranges de spots que já existem são substituídos."""
    if document.format != EXPORT_FORMAT:
        raise CustomRangeError(
            "Arquivo não reconhecido: esperava um JSON exportado pelo Poker Range Helper."
        )
    if document.version != EXPORT_VERSION:
        raise CustomRangeError(f"Versão de arquivo não suportada: {document.version}.")

    validated: list[CustomRangeData] = []
    for index, item in enumerate(document.ranges, start=1):
        try:
            validated.append(_validated(item))
        except UserInputError as error:
            raise CustomRangeError(f"Range {index} do arquivo é inválido: {error}") from error
    created, updated = customs.import_ranges(validated)
    return ImportResult(created=created, updated=updated)


@router.get("/{range_id}", response_model=CustomRangeOut)
def get_custom_range(range_id: int, customs: CustomRanges) -> CustomRangeOut:
    return _output(customs.get(range_id))


@router.delete("/{range_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_custom_range(range_id: int, customs: CustomRanges) -> None:
    customs.delete(range_id)
