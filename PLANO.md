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

### Fase 0 — Setup

- **Python 3.12 no venv.** O `eval7` (0.1.11) só publica wheel até o CPython 3.12 e a máquina não tem compilador C. O `pyproject.toml` instala `eval7` em Python < 3.13 e `phevaluator` em 3.13+; `app/equity/evaluator.py` esconde a diferença. Os testes das fases 0–2 foram rodados nas duas combinações (3.12 + eval7 e 3.13 + phevaluator).
- **`httpx2` no lugar de `httpx`** nas dependências de dev: é o que o `TestClient` do Starlette 1.x usa (com `httpx` ele emite aviso de depreciação).
- **Frontend montado à mão** (sem `npm create vite`, que hoje faz perguntas interativas), com as versões atuais: Vite 8, React 19, TypeScript 7, Tailwind 4.3. Sem ESLint, que não estava no plano; o `tsc` roda em modo estrito.
- **Repositório Git próprio** dentro de `PokerStatistics/`, com `origin` em `github.com/SrMedeirosJr/PokerStatistics`, um commit por fase direto na `main`. `.gitattributes` força fim de linha LF.

### Fase 1 — Core

- A entrada de mãos também aceita `10` no lugar de `T` e símbolos de naipe (`K♥9♦`). Par com sufixo (`99s`, `99o`) é rejeitado.
- No parser de ranges, `AK` sem sufixo vale `AKs` + `AKo`. A serialização devolve a forma canônica mais compacta (`AA,KK` vira `KK+`; `T9s-65s` vira a lista das cinco mãos).
- **Extensão: peso por trecho** com `:` (ex.: `K9o:0.4`), para representar ranges com frequência mista. É o que permite mandar um range de push misto para `/api/equity`.
- O BB não tem cenário `open` (se todos foldam até ele, a mão acabou).

### Fase 2 — Equity

- Todo erro da API responde `{"detail": "<mensagem em português>"}` (string), inclusive os erros de validação do Pydantic, que são traduzidos em `app/api/errors.py`.
- Quando `hero` é uma classe, cada simulação sorteia um par (combo do herói, combo do adversário) sem carta repetida, com probabilidade proporcional ao peso do combo do adversário.
- `iterations` é limitado a 100–200.000 e o request aceita `seed` opcional (usado nos testes).

### Fase 3 — Matriz de equity e solver

- **Matriz por boards compartilhados.** Em vez de 20.000 simulações independentes por par de classes, cada board sorteado é avaliado uma vez para todos os combos vivos e todos os pares compatíveis são comparados nele. A matriz versionada usa 100.000 boards (seed 20261008), o que dá centenas de milhares de confrontos por par, bem acima do alvo de 20.000. Leva cerca de 8 minutos em 4 processos nesta máquina.
- **Contagem por ordenação.** Comparar 1326 × 1326 combos por board ficou lento (~70 ms/board). `BoardSimulator` ordena os combos por força, tira as contagens por classe de somas cumulativas e desconta só os pares que repetem carta (~10 ms/board). Um teste compara o resultado com a comparação direta.
- **Solver por subjogo.** No modelo v1 cada posição de push forma um jogo independente (o pusher contra quem ainda vai agir), então cada um é resolvido separadamente. No empate de EV a melhor resposta é fold.
- **Rodadas de aquecimento.** Antes da rodada final (tolerância 1e-4) o fictitious play roda 2 rodadas com tolerância 1e-3, cada uma partindo da anterior. Sem isso as primeiras iterações, longe do equilíbrio, deixam um resíduo pequeno na média de muitas mãos: em 8-max 10bb, 1.238 classes ficavam com frequência estritamente entre 0 e 1, contra 55 com o aquecimento.
- **Máximo de 20.000 iterações**, e não 2.000: com passo `1/t`, uma mão mista só deixa a variação abaixo de 1e-4 depois de 5.000 a 10.000 iterações.
- **Exploitability por spot.** Como "variação < 1e-4" é um critério fraco para fictitious play, cada spot também guarda o maior ganho que um jogador teria desviando sozinho. Nos 1.560 spots gerados o máximo foi 0,00014 bb (9-max 5bb, UTG1).
- **Formato do JSON.** Frequências com 3 casas; resíduo abaixo de 0,5% vira ação pura. Cada spot ganhou um campo `solver` (`iterations`, `converged`, `exploitability_bb`). O arquivo é escrito com um spot por linha.
- `generate` e `equity_matrix` aceitam `--workers` (padrão: todos os núcleos).
- **Limitação do modelo abaixo de 5bb.** Com 3bb e 4bb o modelo "só o primeiro call conta" satura: quem paga primeiro fica heads-up e os blinds dos outros viram dinheiro morto, então all-in e call ficam baratos demais. Em 9-max o UTG abre 35,3% com 5bb, 74,4% com 4bb e 95,5% com 3bb, e o BB paga 100% contra o UTG com 4bb. Não é falha de convergência: partindo da solução do stack vizinho o solver chega ao mesmo equilíbrio. Efeito sobre os critérios de aceite:
  - "Posições mais cedo têm range de push menor": vale em todos os stacks de 5bb para cima (e `UTG < CO < BTN < SB` é estrito). Com 3bb, em mesas de 6 a 9 jogadores, o BTN abre menos que o CO (9-max: 92,5% contra 95,5%).
  - "BB paga mais largo contra o SB que contra o UTG": vale em todos os stacks de 5bb para cima. Com 3bb os dois são 100%; com 4bb, em mesas de 7 a 9 jogadores, o BB paga um pouco mais contra a primeira posição (9-max: 100% contra 99,1%).
  - AA/KK sempre all-in/call, monotonia no stack e convergência valem nos 1.560 spots.

  Os testes cobrem esses dois critérios integralmente de 5bb para cima e, abaixo disso, garantem que uma inversão só acontece com os ranges já saturados (push acima de 85%, call acima de 95%). Resolver de verdade exige pots multiway no solver, que está em "Futuro".

### Fase 4 — API de ranges

- `/api/spots` responde `{"tables": [{"players", "stacks", "positions", "scenarios"}]}`, com os cenários válidos por posição, para o frontend não precisar repetir a regra.
- `/api/ranges` e `/api/lookup` devolvem, além do que o plano lista, `players`, `position`, `scenario` (já normalizados) e `combos` (combos do range ponderados pela frequência, para a legenda `466 / 1326`).
- **Stack fora da lista:** usa o mais próximo; no empate (ex.: 9bb entre 8 e 10) usa o menor.
- Se `stack` vier junto com `chips`/`big_blind`, vale o `stack`.
- Mesa válida mas sem arquivo de ranges responde 404; qualquer entrada inválida responde 422.

### Fase 5 — Frontend principal

- **Testes do frontend com Vitest + Testing Library** (não estavam na stack do plano), rodando o `App` contra uma API falsa (`src/test/fakeApi.ts`). O aceite também foi conferido no Edge de verdade, contra o backend real, em 1280 px e 390 px de largura.
- Sem mão válida a tela consulta `/api/ranges` para já mostrar o grid do spot; com mão válida consulta `/api/lookup`. As duas chamadas usam o debounce de 200 ms.
- A validação da mão ao digitar repete no frontend as regras do backend (`src/lib/hands.ts`), para não depender de uma chamada à API.
- O seletor visual de cartas começa recolhido em telas estreitas, para o resultado aparecer sem rolar muito.
- Os campos "fichas" e "big blind" aceitam o formato brasileiro (`12.500`, `1,5`).
- O tooltip do grid é o `title` nativo do navegador; no celular, tocar na célula seleciona a mão e o card mostra as frequências.
- A tela avisa quando o stack usado é menor que 5 bb (saturação do modelo) e quando o stack informado passa de 25 bb (push/fold deixa de ser a estratégia adequada).

### Fase 6 — Equity e ajudas

- O `EquityPanel` busca em `/api/ranges` o range de `open` da posição que deu all-in (mesma mesa e mesmo stack) e manda para `/api/equity` como range com pesos, então mãos mistas do pusher entram com a frequência certa.
- A chamada usa 20.000 simulações e **semente fixa**, para o mesmo spot e a mesma mão mostrarem sempre o mesmo número. Conferido no navegador: A9o no BB contra o all-in do CO (8 jogadores, 10 bb) mostra 52,9%, e a API chamada direto com 100.000 simulações dá 52,6%.
- Se a mão foi informada com naipes (`Ah9d`), a equity é calculada para essas cartas exatas; se foi uma classe (`A9o`), é a média dos combos.
- Um erro no cálculo da equity aparece dentro do painel e não esconde a recomendação.
- O `PositionHelper` fica recolhido por padrão e os assentos da mini-mesa são clicáveis (escolhem a posição).

### Fase 7 — Ranges personalizados

- **SQLAlchemy 2** (e não SQLModel), com SQLite em `backend/data/custom_ranges.db`. O arquivo fica fora do Git por ser dado do usuário; a variável `POKER_DATABASE_URL` aponta para outro banco. Os testes sempre usam um banco temporário.
- **Um range por spot** (mesa, stack, posição, situação). `POST /api/custom-ranges` grava e, se já existir um range para o mesmo spot, substitui; não há `PUT`. `DELETE /api/custom-ranges/{id}` exclui.
- **Como o lookup escolhe.** Para um spot concorrem os stacks gerados pelo solver e os dos ranges personalizados desse mesmo spot; vale o mais próximo do stack pedido e, no empate, o menor. Se houver os dois no stack escolhido, vale o personalizado. Exemplo com um open de CO em 40 bb salvo: pedir 35 bb usa o personalizado; pedir 30 bb (empate entre 20 e 40) usa a tabela de 20 bb do solver; BTN com 40 bb continua na tabela de 20 bb.
- As respostas de `/api/ranges` e `/api/lookup` ganharam `source` (`solver` ou `custom`), `custom_id` e `name`. Em `/api/spots`, cada mesa ganhou `custom_spots` e os stacks personalizados entram em `stacks`.
- Ações aceitas num range personalizado: `allin`, `raise`, `call` e `fold`, com frequências de 3 casas; o que faltar para 100% numa mão vira fold.
- **Colar um range** usa `POST /api/ranges/parse`, que reaproveita o parser do backend (inclusive pesos), em vez de reescrever o parser no frontend.
- **Exportar/importar:** `GET /api/custom-ranges/export` e `POST /api/custom-ranges/import`, no formato `poker-range-helper/custom-ranges` versão 1. A importação valida o arquivo inteiro antes de gravar e substitui os ranges de spots que já existem.
- O editor fica numa aba "Meus ranges": escolhe-se a ação do pincel e pinta-se clicando ou arrastando. O selo "personalizado" aparece na lista de ranges salvos, no atalho "Seus ranges nesta mesa" dos seletores, no card da recomendação e na legenda; o botão do stack ganha um ponto roxo.
- Em `vs_{POS}`, o painel de equity usa as mãos de all-in do range de `open` de quem empurrou. Se esse range for um personalizado sem nenhum all-in, o painel avisa em vez de calcular.
- Os avisos de stack (abaixo de 5 bb, acima da maior tabela) só aparecem para ranges do solver.
