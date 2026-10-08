/** Rótulos, cores e formatação das ações (all-in / call / fold). */

import type { ActionName, Frequencies, RangeMap } from '../types.ts'

export const ACTION_LABEL: Record<ActionName, string> = {
  allin: 'All-in',
  call: 'Call',
  fold: 'Fold',
}

export const ACTION_COLOR: Record<ActionName, string> = {
  allin: '#dc2626',
  call: '#16a34a',
  fold: '#334155',
}

export const ACTION_ORDER: ActionName[] = ['allin', 'call', 'fold']

/** Em 'open' o herói decide all-in ou fold; contra um all-in, call ou fold. */
export function activeAction(scenario: string): 'allin' | 'call' {
  return scenario === 'open' ? 'allin' : 'call'
}

export function scenarioLabel(scenario: string): string {
  return scenario === 'open' ? 'Open' : `vs ${scenario.slice('vs_'.length)}`
}

/** Ações com frequência maior que zero, na ordem all-in, call, fold. */
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
 * Mãos que tomam `action`, na notação de range com peso que a API de equity aceita
 * (ex.: 'AA,AKs,K9o:0.4').
 */
export function weightedRange(range: RangeMap, action: ActionName): string {
  return Object.entries(range)
    .flatMap(([hand, frequencies]) => {
      const weight = frequencies[action] ?? 0
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

/** 'All-in 40% · Fold 60%'. */
export function describeFrequencies(frequencies: Frequencies): string {
  return presentActions(frequencies)
    .map(([action, frequency]) => `${ACTION_LABEL[action]} ${formatPercent(frequency)}`)
    .join(' · ')
}
