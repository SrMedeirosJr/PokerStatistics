/** 'raise' só aparece em ranges personalizados; os do solver usam all-in, call e fold. */
export type ActionName = 'allin' | 'raise' | 'call' | 'fold'

/** Frequência (0..1) de cada ação para uma mão; ações com frequência zero não aparecem. */
export type Frequencies = Partial<Record<ActionName, number>>

/** Classe de mão ('AKs', 'K9o', '99') -> frequências. */
export type RangeMap = Record<string, Frequencies>

export type Recommendation = ActionName | 'mixed'

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
  /** Stacks com ranges do solver e/ou personalizados. */
  stacks: number[]
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
  /** 'solver' para ranges gerados; 'custom' para os que o usuário salvou. */
  source: 'solver' | 'custom'
  custom_id: number | null
  name: string | null
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
