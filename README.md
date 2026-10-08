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

## O que o app cobre

- **Até 20 bb:** push/fold calculado pelo solver do projeto (Nash aproximado em chipEV).
- **De 25 a 100 bb:** tabelas de referência com raise, 3-bet, call e fold e tamanho
  sugerido de aposta. São montadas por heurística, **não por solver**: servem de ponto
  de partida e podem ser ajustadas em "Meus ranges".
- **Aba "Torneio":** você informa fichas, blinds e posição uma vez; a cada mão digita só
  as cartas e aperta Enter, e a posição avança sozinha. Mostra também quantas mãos
  faltam para os blinds e quanto custa uma volta na mesa.

## Ranges personalizados

Na aba "Meus ranges" dá para pintar um range (raise, call, all-in, fold) para qualquer
spot e stack, ou colar uma string como `22+,A2s+,KTo+`. Os ranges salvos ficam em
`backend/data/custom_ranges.db` (SQLite, fora do Git) e podem ser exportados e
importados em JSON pela própria tela. Para usar outro banco, defina
`POKER_DATABASE_URL` antes de subir o backend (ex.: `sqlite:///C:/dados/ranges.db`).

## Dados gerados

A matriz de equity (`backend/data/equity_matrix.npz`), os ranges de push/fold
(`backend/data/ranges/*.json`) e as tabelas de referência
(`backend/data/reference/*.json`) já vêm no repositório, então o app roda sem executar
o solver. Para gerar de novo, a partir de `backend/` com o venv ativo:

```powershell
python -m app.solver.equity_matrix --boards 100000 --seed 20261008     # ~8 min
python -m app.solver.generate --players 2-9 --stacks 3,4,5,6,7,8,10,12,15,20 --ante 0.125
python -m app.reference.generate                                       # tabelas de 25 a 100 bb
```
