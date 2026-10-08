/** Rótulos, cores e formatação das ações (all-in / call / fold). */

import type { ActionName, Frequencies, RangeMap, RangeSource } from '../types.ts'
import { comboCount } from './hands.ts'

export const ACTION_LABEL: Record<ActionName, string> = {
  allin: 'All-in',
  raise: 'Raise',
  call: 'Call',
  fold: 'Fold',
}

export const ACTION_COLOR: Record<ActionName, string> = {
  allin: '#dc2626',
  raise: '#2563eb',
  call: '#16a34a',
  fold: '#334155',
}

export const ACTION_ORDER: ActionName[] = ['allin', 'raise', 'call', 'fold']

/** Em 'open' o herói decide all-in ou fold; contra um all-in, call ou fold. */
export function activeAction(scenario: string): 'allin' | 'call' {
  return scenario === 'open' ? 'allin' : 'call'
}

export function scenarioLabel(scenario: string): string {
  return scenario === 'open' ? 'Open' : `vs ${scenario.slice('vs_'.length)}`
}

/**
 * Explica a situação. Nas tabelas de push/fold (solver) quem veio antes deu all-in; nas
 * de stack fundo (referência ou personalizadas) abriu com raise.
 */
export function scenarioHelp(scenario: string, source: RangeSource = 'solver'): string {
  if (scenario === 'open') {
    return 'Open: todos antes de você foldaram e você é o primeiro a entrar no pote.'
  }
  const entered = source === 'solver' ? 'deu all-in' : 'abriu com raise'
  return `${scenarioLabel(scenario)}: essa posição ${entered} e quem estava entre vocês foldou.`
}

/** Marca dos stacks nos seletores: de onde vem a tabela daquele stack. */
export function stackMark(
  stack: number,
  table: { reference_stacks: number[]; custom_spots: { stack: number }[] },
): { mark?: string; markClass?: string } {
  if (table.custom_spots.some((spot) => spot.stack === stack)) {
    return { mark: 'tem range personalizado' }
  }
  if (table.reference_stacks.includes(stack)) {
    return { mark: 'tabela de referência', markClass: 'bg-amber-400' }
  }
  return {}
}

/** Combos (de 1326) de cada ação num range, ponderados pela frequência. */
export function combosByAction(range: RangeMap): Record<ActionName, number> {
  const totals: Record<ActionName, number> = { allin: 0, raise: 0, call: 0, fold: 0 }
  for (const [hand, frequencies] of Object.entries(range)) {
    for (const [action, frequency] of presentActions(frequencies)) {
      totals[action] += comboCount(hand) * frequency
    }
  }
  return totals
}

/** Ações com frequência maior que zero, na ordem all-in, raise, call, fold. */
export function presentActions(frequencies: Frequencies): [ActionName, number][] {
  return ACTION_ORDER.flatMap((action): [ActionName, number][] => {
    const frequency = frequencies[action] ?? 0
    return frequency > 0 ? [[action, frequency]] : []
  })
}

/** Cor da célula: sólida para ação pura, faixas proporcionais para frequência mista. */
export function cellBackground(frequencies: Frequencies): string {
  const actions = presentActions(frequencies)
  if (actions.length === 1) return ACTION_COLOR[actions[0][0]]
  const stops: string[] = []
  let start = 0
  for (const [action, frequency] of actions) {
    const end = start + frequency * 100
    stops.push(`${ACTION_COLOR[action]} ${start.toFixed(1)}% ${end.toFixed(1)}%`)
    start = end
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/**
 * Mãos que não foldam, na notação de range com peso que a API de equity aceita
 * (ex.: 'AA,AKs,K9o:0.4'). Num range de 'open' é com o que a posição entra no pote:
 * all-in nas tabelas de push/fold, raise nas de stack fundo.
 */
export function playedRange(range: RangeMap): string {
  return Object.entries(range)
    .flatMap(([hand, frequencies]) => {
      const weight = Math.round((1 - (frequencies.fold ?? 0)) * 1000) / 1000
      if (weight <= 0) return []
      return [weight >= 1 ? hand : `${hand}:${weight}`]
    })
    .join(',')
}

const percentFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

/** 0.4 -> '40%'. */
export function formatPercent(fraction: number): string {
  return `${percentFormat.format(fraction * 100)}%`
}

/** 11.75 -> '11,75'. */
export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

/** Nome da ação na situação: contra um raise, o raise do herói é um 3-bet. */
export function actionLabel(action: ActionName, scenario = 'open'): string {
  return action === 'raise' && scenario !== 'open' ? '3-bet' : ACTION_LABEL[action]
}

/** 'All-in 40% · Fold 60%'. */
export function describeFrequencies(frequencies: Frequencies, scenario = 'open'): string {
  return presentActions(frequencies)
    .map(([action, frequency]) => `${actionLabel(action, scenario)} ${formatPercent(frequency)}`)
    .join(' · ')
}

/** Texto grande da recomendação: 'ALL-IN', '3-BET', 'MISTO 40/60'. */
export function recommendationHeadline(
  recommendation: ActionName | 'mixed',
  frequencies: Frequencies,
  scenario: string,
): string {
  if (recommendation !== 'mixed') return actionLabel(recommendation, scenario).toUpperCase()
  const shares = presentActions(frequencies).map(([, frequency]) => Math.round(frequency * 100))
  return `MISTO ${shares.join('/')}`
}
