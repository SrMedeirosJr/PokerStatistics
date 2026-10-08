# Poker Range Helper

Aplicação web de apoio a decisões push/fold em MTT (stacks curtos, modelo chipEV).
Backend em FastAPI, frontend em React + Vite + Tailwind. A especificação completa
está em [PLANO.md](PLANO.md).

## Requisitos

- Python 3.11 ou 3.12 (recomendado: 3.12). No Python 3.13+ o `eval7` não tem wheel
  para Windows e o projeto instala o `phevaluator` no lugar.
- Node.js 20+ e npm.

## Backend

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"

uvicorn app.main:app --reload      # http://localhost:8000/api/health
```

Testes e lint:

```powershell
pytest
ruff check .
ruff format --check .
```

## Frontend

```powershell
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

O Vite encaminha `/api` para `http://localhost:8000`, então o backend precisa estar
rodando para a página funcionar.

```powershell
npm test                           # testes (Vitest)
npm run build                      # typecheck (tsc) + build de produção
```

## Dados gerados

A matriz de equity (`backend/data/equity_matrix.npz`) e os ranges
(`backend/data/ranges/*.json`) já vêm no repositório, então o app roda sem executar o
solver. Para gerar de novo, a partir de `backend/` com o venv ativo:

```powershell
python -m app.solver.equity_matrix --boards 100000 --seed 20261008     # ~8 min
python -m app.solver.generate --players 2-9 --stacks 3,4,5,6,7,8,10,12,15,20 --ante 0.125
```
