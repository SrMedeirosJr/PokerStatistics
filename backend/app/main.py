from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import routes_equity, routes_ranges
from app.api.errors import install_error_handlers
from app.services.range_store import RangeStore


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.range_store = RangeStore.from_directory()
    yield


app = FastAPI(title="Poker Range Helper", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
install_error_handlers(app)
app.include_router(routes_ranges.router)
app.include_router(routes_equity.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
