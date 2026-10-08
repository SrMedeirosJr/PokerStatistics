/** Estado da aba de torneio: mesa, blinds, fichas e a posição que roda a cada mão. */

import type { SpotQuery, TableInfo } from '../types.ts'
import { parseAmount, validPosition, validScenario } from './spotState.ts'

export const STORAGE_KEY = 'poker-range-helper:torneio:v1'
const MAX_HISTORY = 30

export interface HandRecord {
  number: number
  position: string
  hand: string
  /** Recomendação mostrada para a mão (ex.: 'ALL-IN', '3-BET', 'MISTO 40/60'). */
  action: string
  stackBb: number
}

export interface TournamentState {
  players: number
  position: string
  scenario: string
  chips: string
  smallBlind: string
  bigBlind: string
  ante: string
  handNumber: number
  handText: string
  /** Mãos já jogadas na sessão, da mais recente para a mais antiga. */
  history: HandRecord[]
}

export type TournamentAction =
  | { type: 'sync'; tables: TableInfo[] }
  | { type: 'setPlayers'; players: number; tables: TableInfo[] }
  | { type: 'setPosition'; position: string; tables: TableInfo[] }
  | { type: 'setScenario'; scenario: string }
  | { type: 'setField'; field: 'chips' | 'smallBlind' | 'bigBlind' | 'ante'; value: string }
  | { type: 'setHand'; handText: string }
  | { type: 'nextHand'; tables: TableInfo[]; record: HandRecord | null }
  | { type: 'previousHand'; tables: TableInfo[] }
  | { type: 'reset' }

export const initialTournamentState: TournamentState = {
  players: 8,
  position: 'BB',
  scenario: 'vs_SB',
  chips: '',
  smallBlind: '',
  bigBlind: '',
  ante: '',
  handNumber: 1,
  handText: '',
  history: [],
}

function tableFor(tables: TableInfo[], players: number): TableInfo | undefined {
  return tables.find((table) => table.players === players) ?? tables[0]
}

/**
 * Posição na mão seguinte. O botão anda uma cadeira por mão, então cada jogador recua
 * uma posição na ordem de ação: BB -> SB -> BTN -> CO -> ... -> UTG -> BB.
 */
export function nextPosition(positions: string[], position: string): string {
  const index = positions.indexOf(position)
  return positions[(index - 1 + positions.length) % positions.length]
}

/** Inverso de `nextPosition`: a posição que o jogador tinha na mão anterior. */
export function previousPosition(positions: string[], position: string): string {
  return positions[(positions.indexOf(position) + 1) % positions.length]
}

/** Quantas mãos faltam para o jogador chegar à posição `target` (0 = é nesta mão). */
export function handsUntil(positions: string[], position: string, target: string): number {
  const count = positions.length
  return (((positions.indexOf(position) - positions.indexOf(target)) % count) + count) % count
}

function withValidSpot(state: TournamentState, tables: TableInfo[]): TournamentState {
  const table = tableFor(tables, state.players)
  if (!table) return state
  const position = validPosition(table, state.position)
  const scenario = validScenario(table, position, state.scenario)
  return { ...state, players: table.players, position, scenario }
}

/** Ao mudar de posição a situação volta para o padrão dela ('open'; no BB, contra o SB). */
function atPosition(state: TournamentState, position: string, tables: TableInfo[]): TournamentState {
  return withValidSpot({ ...state, position, scenario: 'open' }, tables)
}

export function tournamentReducer(
  state: TournamentState,
  action: TournamentAction,
): TournamentState {
  switch (action.type) {
    case 'sync':
      return withValidSpot(state, action.tables)
    case 'setPlayers':
      return withValidSpot({ ...state, players: action.players }, action.tables)
    case 'setPosition':
      return atPosition(state, action.position, action.tables)
    case 'setScenario':
      return { ...state, scenario: action.scenario }
    case 'setField':
      return { ...state, [action.field]: action.value }
    case 'setHand':
      return { ...state, handText: action.handText }
    case 'nextHand': {
      const table = tableFor(action.tables, state.players)
      if (!table) return state
      const history = action.record
        ? [action.record, ...state.history].slice(0, MAX_HISTORY)
        : state.history
      return {
        ...atPosition(state, nextPosition(table.positions, state.position), action.tables),
        handNumber: state.handNumber + 1,
        handText: '',
        history,
      }
    }
    case 'previousHand': {
      const table = tableFor(action.tables, state.players)
      if (!table || state.handNumber <= 1) return state
      const handNumber = state.handNumber - 1
      return {
        ...atPosition(state, previousPosition(table.positions, state.position), action.tables),
        handNumber,
        handText: '',
        history: state.history.filter((record) => record.number < handNumber),
      }
    }
    case 'reset':
      return { ...initialTournamentState, players: state.players }
  }
}

export interface BlindInfo {
  /** Stack em big blinds, ou null se faltar fichas ou big blind. */
  stackBb: number | null
  /** Custo de uma volta completa na mesa (SB + BB + antes), em fichas. */
  orbitCost: number | null
  /** Quantas voltas o stack paga sem jogar nenhuma mão. */
  orbits: number | null
}

export function blindInfo(state: TournamentState): BlindInfo {
  const chips = parseAmount(state.chips)
  const bigBlind = parseAmount(state.bigBlind)
  const smallBlind = parseAmount(state.smallBlind)
  const ante = parseAmount(state.ante) ?? 0
  const stackBb = chips !== null && bigBlind !== null ? chips / bigBlind : null
  const orbitCost =
    bigBlind !== null && smallBlind !== null ? smallBlind + bigBlind + ante * state.players : null
  return {
    stackBb,
    orbitCost,
    orbits: chips !== null && orbitCost !== null ? chips / orbitCost : null,
  }
}

/** Consulta para a API, ou null enquanto faltam fichas ou big blind. */
export function tournamentQuery(state: TournamentState, tables: TableInfo[]): SpotQuery | null {
  const chips = parseAmount(state.chips)
  const bigBlind = parseAmount(state.bigBlind)
  if (!tableFor(tables, state.players) || chips === null || bigBlind === null) return null
  return {
    players: state.players,
    position: state.position,
    scenario: state.scenario,
    stack: { chips, big_blind: bigBlind },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Sessão salva no navegador; qualquer coisa fora do formato esperado é descartada. */
export function loadTournament(storage: Pick<Storage, 'getItem'>): TournamentState {
  try {
    const saved: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    if (!isRecord(saved)) return initialTournamentState
    const merged = { ...initialTournamentState }
    for (const key of ['position', 'scenario', 'chips', 'smallBlind', 'bigBlind', 'ante'] as const) {
      if (typeof saved[key] === 'string') merged[key] = saved[key]
    }
    for (const key of ['players', 'handNumber'] as const) {
      const value = saved[key]
      if (typeof value === 'number' && Number.isInteger(value) && value >= 1) merged[key] = value
    }
    if (Array.isArray(saved.history)) {
      merged.history = saved.history.filter(
        (item): item is HandRecord =>
          isRecord(item) &&
          typeof item.number === 'number' &&
          typeof item.position === 'string' &&
          typeof item.hand === 'string' &&
          typeof item.action === 'string' &&
          typeof item.stackBb === 'number',
      )
    }
    return merged
  } catch {
    return initialTournamentState
  }
}

export function saveTournament(storage: Pick<Storage, 'setItem'>, state: TournamentState): void {
  try {
    // A mão em andamento não é guardada: ao reabrir, o campo começa vazio.
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, handText: '' }))
  } catch {
    // Sem espaço ou com o armazenamento bloqueado, a sessão só não é lembrada.
  }
}
