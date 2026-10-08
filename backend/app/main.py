from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import routes_equity
from app.api.errors import install_error_handlers

app = FastAPI(title="Poker Range Helper", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
install_error_handlers(app)
app.include_router(routes_equity.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
