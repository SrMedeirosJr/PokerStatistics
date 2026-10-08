export type ActionName = 'allin' | 'call' | 'fold'

/** Frequência (0..1) de cada ação para uma mão; ações com frequência zero não aparecem. */
export type Frequencies = Partial<Record<ActionName, number>>

/** Classe de mão ('AKs', 'K9o', '99') -> frequências. */
export type RangeMap = Record<string, Frequencies>

export type Recommendation = ActionName | 'mixed'

export interface TableInfo {
  players: number
  stacks: number[]
  positions: string[]
  /** Cenários válidos por posição: 'open' e/ou 'vs_{POS}'. */
  scenarios: Record<string, string[]>
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
