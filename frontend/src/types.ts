/** 'raise' só aparece em ranges personalizados; os do solver usam all-in, call e fold. */
export type ActionName = 'allin' | 'raise' | 'call' | 'fold'

/** Frequência (0..1) de cada ação para uma mão; ações com frequência zero não aparecem. */
export type Frequencies = Partial<Record<ActionName, number>>

/** Classe de mão ('AKs', 'K9o', '99') -> frequências. */
export type RangeMap = Record<string, Frequencies>

export type Recommendation = ActionName | 'mixed'

/**
 * De onde vem um range: 'solver' (push/fold calculado), 'reference' (heurística de stack
 * fundo) ou 'custom' (salvo pelo usuário).
 */
export type RangeSource = 'solver' | 'reference' | 'custom'

/** Spot com range personalizado salvo, para marcar nos seletores. */
export interface CustomSpotInfo {
  id: number
  name: string
  stack: number
  position: string
  scenario: string
}

export interface TableInfo {
  players: number
  /** Stacks com ranges do solver, de referência e/ou personalizados. */
  stacks: number[]
  /** Os que vêm das tabelas de referência (heurística de stack fundo). */
  reference_stacks: number[]
  positions: string[]
  /** Cenários válidos por posição: 'open' e/ou 'vs_{POS}'. */
  scenarios: Record<string, string[]>
  custom_spots: CustomSpotInfo[]
}

export interface SpotsResponse {
  tables: TableInfo[]
}

export interface RangeResponse {
  spot_id: string
  players: number
  position: string
  scenario: string
  stack_requested: number
  stack_used: number
  range_pct: number
  combos: number
  range: RangeMap
  source: RangeSource
  custom_id: number | null
  name: string | null
  /** Tamanho sugerido de cada aposta, em bb (só nas tabelas de referência). */
  sizes: Partial<Record<ActionName, number>>
}

/** Range personalizado como enviado para a API; mãos ausentes em `actions` são fold. */
export interface CustomRangeInput {
  name: string
  players: number
  stack_bb: number
  position: string
  scenario: string
  actions: RangeMap
}

export interface CustomRange extends CustomRangeInput {
  id: number
  spot_id: string
  range_pct: number
  combos: number
  updated_at: string
}

export interface ImportResult {
  created: number
  updated: number
}

export interface ParsedRange {
  /** Classe de mão -> peso (0..1). */
  hands: Record<string, number>
  combos: number
}

export interface LookupResponse extends RangeResponse {
  hand: string
  recommendation: Recommendation
  frequencies: Frequencies
}

export interface EquityResponse {
  win: number
  tie: number
  lose: number
  equity: number
}

/** Stack informado em big blinds ou em fichas + valor do big blind. */
export type StackInput = { stack: number } | { chips: number; big_blind: number }

export interface SpotQuery {
  players: number
  position: string
  scenario: string
  stack: StackInput
}
