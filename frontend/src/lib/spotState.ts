/** Estado dos seletores (mesa, stack, posição, situação, mão) e a consulta derivada dele. */

import type { SpotQuery, TableInfo } from '../types.ts'

export interface SpotState {
  tables: TableInfo[]
  players: number
  /** Stack em big blinds escolhido nos botões. */
  stack: number
  /** Quando ligado, o stack vem de fichas / big blind em vez dos botões. */
  chipsMode: boolean
  chips: string
  bigBlind: string
  position: string
  scenario: string
  handText: string
}

export type SpotAction =
  | { type: 'tablesLoaded'; tables: TableInfo[] }
  | { type: 'setPlayers'; players: number }
  | { type: 'setStack'; stack: number }
  | { type: 'setChipsMode'; enabled: boolean }
  | { type: 'setChips'; chips: string }
  | { type: 'setBigBlind'; bigBlind: string }
  | { type: 'setPosition'; position: string }
  | { type: 'setScenario'; scenario: string }
  | { type: 'setHand'; handText: string }
  | { type: 'selectSpot'; players: number; stack: number; position: string; scenario: string }

export const initialSpotState: SpotState = {
  tables: [],
  players: 8,
  stack: 10,
  chipsMode: false,
  chips: '',
  bigBlind: '',
  position: 'CO',
  scenario: 'open',
  handText: '',
}

export function currentTable(state: SpotState): TableInfo | undefined {
  return state.tables.find((table) => table.players === state.players)
}

function nearest(options: number[], value: number): number {
  return options.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best,
  )
}

/** A posição pedida, se existir na mesa; senão o BTN (ou a primeira posição). */
export function validPosition(table: TableInfo, position: string): string {
  if (table.positions.includes(position)) return position
  return table.positions.includes('BTN') ? 'BTN' : table.positions[0]
}

/** A situação pedida, se for possível para a posição; senão a situação padrão dela. */
export function validScenario(table: TableInfo, position: string, scenario: string): string {
  const scenarios = table.scenarios[position] ?? []
  if (scenarios.includes(scenario)) return scenario
  // O BB nunca abre o pote: o padrão dele é enfrentar o all-in do SB.
  return scenarios.includes('open') ? 'open' : (scenarios.at(-1) ?? 'open')
}

/** Garante que mesa, posição, situação e stack existem nos dados carregados. */
function withValidSpot(state: SpotState): SpotState {
  const table = currentTable(state) ?? state.tables[0]
  if (!table) return state

  const position = validPosition(table, state.position)
  const scenario = validScenario(table, position, state.scenario)
  const stack = table.stacks.length > 0 ? nearest(table.stacks, state.stack) : state.stack
  return { ...state, players: table.players, position, scenario, stack }
}

export function spotReducer(state: SpotState, action: SpotAction): SpotState {
  switch (action.type) {
    case 'tablesLoaded':
      return withValidSpot({ ...state, tables: action.tables })
    case 'setPlayers':
      return withValidSpot({ ...state, players: action.players })
    case 'setStack':
      return { ...state, stack: action.stack, chipsMode: false }
    case 'setChipsMode':
      return { ...state, chipsMode: action.enabled }
    case 'setChips':
      return { ...state, chips: action.chips }
    case 'setBigBlind':
      return { ...state, bigBlind: action.bigBlind }
    case 'setPosition':
      return withValidSpot({ ...state, position: action.position })
    case 'setScenario':
      return withValidSpot({ ...state, scenario: action.scenario })
    case 'setHand':
      return { ...state, handText: action.handText }
    case 'selectSpot':
      return withValidSpot({
        ...state,
        players: action.players,
        stack: action.stack,
        position: action.position,
        scenario: action.scenario,
        chipsMode: false,
      })
  }
}

/**
 * Converte o que o usuário digitou em número positivo, aceitando o formato brasileiro:
 * '12.500' e '12500' valem 12500; '1,5' e '1.5' valem 1,5.
 */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim().replace(/\s/g, '')
  if (!/^\d[\d.,]*$/.test(trimmed)) return null
  const normalized = trimmed.includes(',')
    ? trimmed.replaceAll('.', '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(trimmed)
      ? trimmed.replaceAll('.', '')
      : trimmed
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Stack em bb digitado como fichas / big blind, ou null se faltar algum dos dois. */
export function chipsStack(state: SpotState): number | null {
  const chips = parseAmount(state.chips)
  const bigBlind = parseAmount(state.bigBlind)
  return chips !== null && bigBlind !== null ? chips / bigBlind : null
}

/** Consulta para a API, ou null enquanto os dados necessários não estão completos. */
export function buildQuery(state: SpotState): SpotQuery | null {
  if (!currentTable(state)) return null
  const base = { players: state.players, position: state.position, scenario: state.scenario }
  if (!state.chipsMode) return { ...base, stack: { stack: state.stack } }

  const chips = parseAmount(state.chips)
  const bigBlind = parseAmount(state.bigBlind)
  if (chips === null || bigBlind === null) return null
  return { ...base, stack: { chips, big_blind: bigBlind } }
}
