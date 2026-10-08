# Plano — Poker Range Helper (FastAPI + React + Tailwind)

> **Instruções para o Claude:** este arquivo é a especificação do projeto. Implemente **uma fase por vez**, na ordem. Ao fim de cada fase: rode os testes, confirme que os critérios de aceite passam e só então siga para a próxima. Se algo neste plano estiver ambíguo ou uma biblioteca tiver API diferente da descrita, consulte a documentação oficial e ajuste, registrando a decisão na seção "Decisões" no fim deste arquivo. Não pule testes.

---

## 1. Objetivo

Aplicação web onde o jogador informa:

- número de jogadores na mesa
- stack em big blinds (ou fichas + valor do BB, e o app converte)
- sua posição
- a situação (ninguém entrou ainda / alguém deu all-in antes)
- sua mão (ex.: `K9o`, `AKs`, `99`, `Kh9d`)

E recebe:

- a ação recomendada (all-in / call / fold) com frequência
- o grid 13x13 do range completo, com a mão destacada
- a equity da mão contra o range do adversário (quando houver um)

**Escopo v1:** MTT, push/fold (stacks curtos de 3 a 20bb), modelo chipEV, stacks iguais para todos. Ranges **calculados pelo próprio app** (equilíbrio de Nash aproximado) — não copiar ranges de sites pagos.

---

## 2. Stack técnica

**Backend**
- Python 3.11+
- FastAPI + Uvicorn
- Pydantic v2
- NumPy
- `eval7` para avaliação de mãos (fallback: `phevaluator` se `eval7` não instalar na versão do Python)
- pytest, ruff

**Frontend**
- React + Vite + TypeScript
- Tailwind CSS v4 (plugin `@tailwindcss/vite`, `@import "tailwindcss";` no CSS)
- Estado local com `useState`/`useReducer` (sem lib de estado na v1)

---

## 3. Estrutura de pastas

```
poker-range-helper/
├── PLANO.md
├── README.md
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py                 # FastAPI app, CORS, routers
│   │   ├── api/
│   │   │   ├── routes_ranges.py    # /api/spots, /api/ranges, /api/lookup
│   │   │   └── routes_equity.py    # /api/equity
│   │   ├── core/
│   │   │   ├── cards.py            # parsing, normalização, 169 classes, combos
│   │   │   ├── positions.py        # posições por nº de jogadores
│   │   │   └── range_parser.py     # "AA-22,A2s+,KTo+" <-> lista de classes
│   │   ├── equity/
│   │   │   └── engine.py           # Monte Carlo mão vs range
│   │   ├── solver/
│   │   │   ├── equity_matrix.py    # gera matriz 169x169 de equity + combos
│   │   │   ├── pushfold.py         # solver Nash push/fold (fictitious play)
│   │   │   └── generate.py         # CLI que gera os JSONs de ranges
│   │   ├── models/
│   │   │   └── schemas.py          # modelos Pydantic de request/response
│   │   └── services/
│   │       └── range_store.py      # carrega JSONs em memória no startup
│   ├── data/
│   │   ├── equity_matrix.npz
│   │   └── ranges/                 # ex.: mtt_8max_6bb.json
│   └── tests/
└── frontend/
    ├── vite.config.ts              # proxy /api -> http://localhost:8000
    └── src/
        ├── App.tsx
        ├── lib/api.ts
        ├── lib/hands.ts            # lista das 169 mãos na ordem do grid
        ├── types.ts
        └── components/
            ├── SpotSelector.tsx    # jogadores, stack, posição, situação
            ├── HandInput.tsx       # texto + seletor visual de cartas
            ├── RangeGrid.tsx       # grid 13x13
            ├── ActionResult.tsx    # recomendação em destaque
            ├── EquityPanel.tsx
            ├── Legend.tsx
            └── PositionHelper.tsx  # ajuda para descobrir a posição
```

---

## 4. Conceitos de domínio

### 4.1 Classes de mãos (169)
- 13 pares (`AA`…`22`) — 6 combos cada
- 78 suited (`AKs`…`32s`) — 4 combos cada
- 78 offsuit (`AKo`…`32o`) — 12 combos cada
- Total: 1326 combos

**Ordem do grid (padrão da indústria):** ranks `A K Q J T 9 8 7 6 5 4 3 2`. Célula (linha `i`, coluna `j`):
- `i == j` → par
- `i < j` → suited (`rank[i] + rank[j] + "s"`)
- `i > j` → offsuit (`rank[j] + rank[i] + "o"`)

### 4.2 Normalização da entrada
Aceitar e normalizar para a classe canônica:
- `k9o`, `K9O`, `9Ko` → `K9o`
- `Kh9d` → `K9o`; `Kh9h` → `K9s`; `9s9d` → `99`
- `K9` sem sufixo → erro pedindo `s` ou `o`
- Rejeitar cartas repetidas e ranks/naipes inválidos com mensagem clara em português.

### 4.3 Posições por número de jogadores
| Jogadores | Posições (ordem de ação preflop) |
|---|---|
| 2 | SB (=BTN), BB |
| 3 | BTN, SB, BB |
| 4 | CO, BTN, SB, BB |
| 5 | HJ, CO, BTN, SB, BB |
| 6 | LJ, HJ, CO, BTN, SB, BB |
| 7 | UTG, LJ, HJ, CO, BTN, SB, BB |
| 8 | UTG, UTG1, LJ, HJ, CO, BTN, SB, BB |
| 9 | UTG, UTG1, UTG2, LJ, HJ, CO, BTN, SB, BB |

Assentos vazios não contam.

### 4.4 Situações (scenarios) na v1
- `open`: todos antes do herói foldaram; herói decide all-in ou fold.
- `vs_{POS}`: o jogador em `{POS}` deu all-in, todos entre ele e o herói foldaram; herói decide call ou fold.

Ambas saem naturalmente do solver push/fold (ranges de push e ranges de call).

---

## 5. Solver push/fold (o coração do projeto)

### 5.1 Matriz de equity (pré-computada uma vez)
`solver/equity_matrix.py` gera e salva em `data/equity_matrix.npz`:
- `eq[i][j]`: equity média (all-in preflop, 5 cartas de board) da classe `i` contra a classe `j`, considerando apenas combos compatíveis (sem carta repetida). Empate conta como 0,5.
- `combos[i][j]`: número de combos de `j` compatíveis com um combo de `i` (efeito de bloqueio). Calcular de forma exata.

Use Monte Carlo com `eval7` (alvo: ~20.000 iterações por par de classes; aproveitar simetria `eq[j][i] = 1 - eq[i][j]`). Deve rodar em minutos; mostrar barra de progresso no terminal.

### 5.2 Modelo de jogo (v1)
- N jogadores, todos com stack `S` (em bb, no início da mão).
- Blinds 0,5 / 1; ante por jogador `a` (default `0.125`, configurável; Suprema costuma usar ante por jogador).
- Todos foldam até o herói na posição `i`; herói faz all-in ou fold.
- Cada jogador `j` depois de `i` decide call ou fold contra o all-in.
- **Aproximação v1:** considerar só o **primeiro** caller; depois de um call, os demais foldam (ignora pots multiway). Documentar isso na UI ("modelo simplificado").
- Probabilidades dos callers tratadas de forma independente (ignorando bloqueio entre adversários), mas usando `combos[i][j]` para o bloqueio herói vs adversário.

### 5.3 Contabilidade de EV (usar "stack final esperado")
- `dead(k)` = blind + ante já postados pelo jogador `k`.
- `pot_inicial` = soma de `dead(k)` de todos.
- **Fold do herói:** stack final = `S - dead(i)`.
- **All-in e todos foldam:** stack final = `S - dead(i) + pot_inicial`.
- **All-in e `j` paga:** pot = `2S + soma de dead(k) para k ∉ {i, j}`; stack final esperado do herói = `eq_vs_range_j * pot`.
- Mesma lógica para o caller `j`: comparar `eq * pot` (call) com `S - dead(j)` (fold).

### 5.4 Algoritmo (fictitious play)
1. Inicializar ranges de push e call com algo razoável (ex.: top 30% / top 15%).
2. Para cada iteração `t`:
   - Para cada posição `i`: calcular, para cada classe, EV(push) vs EV(fold) dado os ranges de call atuais → best response.
   - Para cada par (pusher `i`, caller `j`): calcular EV(call) vs EV(fold) contra o range de push atual de `i` → best response.
   - Atualizar a estratégia média: `estrategia = (1 - 1/t) * estrategia + (1/t) * best_response`.
3. Parar quando a variação máxima entre iterações < `1e-4` ou após um número máximo de iterações (ex.: 2000).
4. Guardar frequências (0..1) por classe — podem ficar mistas.

### 5.5 Geração (CLI)
```
python -m app.solver.generate --players 2-9 --stacks 3,4,5,6,7,8,10,12,15,20 --ante 0.125
```
Saída: um JSON por (jogadores, stack) em `data/ranges/`.

### 5.6 Formato do JSON
```json
{
  "meta": {
    "format": "mtt",
    "players": 8,
    "stack_bb": 6,
    "ante_bb": 0.125,
    "model": "chipev-nash-pushfold-v1",
    "generated_at": "2026-10-08T17:00:00Z"
  },
  "spots": {
    "CO_open":  { "actions": { "AA": {"allin": 1.0}, "K9o": {"allin": 1.0}, "Q9o": {"fold": 1.0} } },
    "BB_vs_CO": { "actions": { "AA": {"call": 1.0}, "K9o": {"call": 0.4, "fold": 0.6} } }
  }
}
```
ID do spot exposto pela API: `mtt_{players}max_{stack}bb_{POS}_{scenario}`.

---

## 6. API (FastAPI)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | status |
| GET | `/api/spots` | jogadores, stacks e posições disponíveis |
| GET | `/api/ranges?players=8&stack=6&position=CO&scenario=open` | range completo (169 mãos) |
| GET | `/api/lookup?players=8&stack=6&position=CO&scenario=open&hand=K9o` | recomendação para a mão |
| POST | `/api/equity` | equity mão vs range |

**`/api/lookup` — resposta:**
```json
{
  "hand": "K9o",
  "spot_id": "mtt_8max_6bb_CO_open",
  "stack_requested": 7,
  "stack_used": 6,
  "recommendation": "allin",
  "frequencies": {"allin": 1.0},
  "range_pct": 35.1,
  "range": { "AA": {"allin": 1.0}, "...": {} }
}
```
- Stack fora da lista → usar o mais próximo e informar em `stack_used`.
- `recommendation` = ação de maior frequência; se mista (nenhuma ≥ 0,8), retornar `"mixed"`.
- Também aceitar `chips` + `big_blind` no lugar de `stack` (converter: `stack = chips / big_blind`).

**`POST /api/equity` — request:**
```json
{ "hero": "Kh9d", "villain_range": "22+,A2s+,K9o+", "board": [], "iterations": 20000 }
```
Resposta: `{ "win": 0.47, "tie": 0.02, "lose": 0.51, "equity": 0.48 }`.
`hero` aceita mão específica ou classe (classe → média dos combos).

Validações com erros 422 em português. CORS liberado para `http://localhost:5173`.

---

## 7. Frontend (React + Tailwind)

Layout escuro, responsivo (desktop: seletores à esquerda, grid à direita; mobile: empilhado).

- **SpotSelector:** botões para nº de jogadores, stack (com campo alternativo "fichas" + "BB" que converte), posições (lista muda conforme jogadores), situação (`Open` / `vs UTG` / `vs CO`... só posições anteriores ao herói).
- **HandInput:** campo de texto (`K9o`, `Kh9d`) com validação ao digitar + seletor visual de 2 cartas (rank + naipe).
- **ActionResult:** card grande com a ação ("ALL-IN", "FOLD", "CALL", "MISTO 40/60"), cor correspondente e o stack realmente usado.
- **RangeGrid:** 13x13; célula colorida pela ação (all-in = vermelho, call = verde, fold = cinza; mista = gradiente proporcional); mão do herói com borda destacada; tooltip com frequências; clicar numa célula seleciona essa mão.
- **Legend:** % do range e combos (`466 / 1326`).
- **EquityPanel:** em `vs_{POS}`, calcular automaticamente a equity da mão contra o range de push daquela posição; mostrar win/tie/lose.
- **PositionHelper:** texto curto + mini-mesa explicando como contar a posição a partir do botão (D), ignorando cadeiras vazias.

Atualização automática: qualquer mudança de seletor ou mão dispara `/api/lookup` (debounce 200 ms).

---

## 8. Fases de implementação

### Fase 0 — Setup
- Monorepo com `backend/` e `frontend/`.
- Backend: `pyproject.toml`, FastAPI com `/api/health`, ruff, pytest.
- Frontend: Vite React-TS + Tailwind v4, proxy `/api`.
- README com comandos para rodar ambos.

**Aceite:** `uvicorn app.main:app --reload` responde `/api/health`; `npm run dev` mostra página com Tailwind funcionando e chamando `/api/health`.

### Fase 1 — Core de cartas e mãos
- `cards.py`: lista das 169 classes, combos por classe, normalização (seção 4.2).
- `range_parser.py`: parse e serialização de strings (`22+`, `A2s+`, `KTo+`, `T9s-65s`, `AA,KK`).
- `positions.py`: tabela 4.3.

**Aceite (testes):** 169 classes / 1326 combos; todas as normalizações da 4.2; parser ida e volta; `"22+"` = 13 classes.

### Fase 2 — Motor de equity
- `equity/engine.py` com Monte Carlo (seed opcional para testes).
- Endpoint `POST /api/equity`.

**Aceite (testes, tolerância ±1,5 p.p.):** AA vs KK ≈ 81–82%; AKs vs QQ ≈ 46%; AKo vs 22 próximo de 47%; mão vs ela mesma ≈ 50%.

### Fase 3 — Matriz de equity + solver push/fold
- `equity_matrix.py` (seção 5.1), salvando `.npz`.
- `pushfold.py` (seções 5.2–5.4).
- `generate.py` (seção 5.5) gerando todos os JSONs.

**Aceite (testes de propriedade):**
- AA e KK sempre all-in / call em qualquer spot.
- Para a mesma posição, % do range de push não aumenta quando o stack aumenta.
- Com o mesmo stack, posições mais cedo têm range de push menor que posições mais tarde (UTG < CO < BTN < SB).
- Range de call do BB vs SB é maior que o range de call do BB vs UTG.
- Solver converge (variação < 1e-4) em todos os spots gerados.

### Fase 4 — API de ranges
- `range_store.py` carrega JSONs no startup.
- Rotas `/api/spots`, `/api/ranges`, `/api/lookup` (seção 6), incluindo arredondamento de stack e conversão fichas → bb.

**Aceite:** testes com `TestClient` cobrindo sucesso, mão inválida, posição inválida para o nº de jogadores, cenário `vs_{POS}` impossível (pusher depois do herói) e stack fora da lista.

### Fase 5 — Frontend principal
- SpotSelector, HandInput, ActionResult, RangeGrid, Legend ligados à API.

**Aceite:** escolher 8 jogadores, 6bb, CO, Open, digitar `K9o` mostra a recomendação e destaca a célula; trocar seletores atualiza sem recarregar; funciona em largura de celular.

### Fase 6 — Equity e ajudas
- EquityPanel automático em `vs_{POS}`.
- PositionHelper.
- Tratamento de loading e erros na UI.

**Aceite:** em `BB vs CO` com `A9o`, painel mostra equity vs range de push do CO; erros da API aparecem em português.

### Fase 7 — Ranges personalizados (stacks maiores)
- Editor de ranges: pintar o grid com ações (raise, call, fold, all-in) ou colar string de range.
- Persistência em SQLite (SQLModel ou SQLAlchemy).
- Spots personalizados aparecem nos seletores com selo "personalizado".
- Exportar/importar ranges em JSON.

**Aceite:** criar um range de open 40bb para CO, salvar, consultar via `/api/lookup` e ver no grid.

### Futuro (fora da v1)
- ICM (bolha, mesa final).
- Stacks diferentes por jogador.
- Pots multiway no solver.
- Cash game 100bb.
- Modo treino (quiz: mostra spot + mão, usuário escolhe a ação, mostra acerto).

---

## 9. Convenções

- Código e nomes em inglês; textos de UI e mensagens de erro em português.
- Tipagem completa (type hints no Python, TypeScript estrito no front).
- Funções puras no `core/` e `solver/`, sem dependência de FastAPI.
- Commits pequenos por fase.
- Dados gerados (`data/ranges/*.json`, `equity_matrix.npz`) versionados, para o app rodar sem rodar o solver.

---

## 10. Decisões

_(O Claude registra aqui decisões tomadas durante a implementação.)_
