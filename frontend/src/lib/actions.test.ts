import { describe, expect, it } from 'vitest'

import {
  ACTION_COLOR,
  actionLabel,
  activeAction,
  cellBackground,
  combosByAction,
  describeFrequencies,
  formatNumber,
  formatPercent,
  playedRange,
  recommendationHeadline,
  scenarioHelp,
  scenarioLabel,
  stackMark,
} from './actions.ts'

describe('ações', () => {
  it('define a ação ativa e o rótulo pela situação', () => {
    expect(activeAction('open')).toBe('allin')
    expect(activeAction('vs_CO')).toBe('call')
    expect(scenarioLabel('open')).toBe('Open')
    expect(scenarioLabel('vs_UTG1')).toBe('vs UTG1')
  })

  it('chama de 3-bet o raise feito contra um raise', () => {
    expect(actionLabel('raise')).toBe('Raise')
    expect(actionLabel('raise', 'open')).toBe('Raise')
    expect(actionLabel('raise', 'vs_CO')).toBe('3-bet')
    expect(actionLabel('allin', 'vs_CO')).toBe('All-in')
    expect(actionLabel('call', 'vs_CO')).toBe('Call')
  })

  it('pinta ação pura com cor sólida', () => {
    expect(cellBackground({ allin: 1 })).toBe(ACTION_COLOR.allin)
    expect(cellBackground({ raise: 1 })).toBe(ACTION_COLOR.raise)
    expect(cellBackground({ call: 1 })).toBe(ACTION_COLOR.call)
    expect(cellBackground({ fold: 1 })).toBe(ACTION_COLOR.fold)
  })

  it('pinta frequência mista com faixas proporcionais', () => {
    expect(cellBackground({ call: 0.4, fold: 0.6 })).toBe(
      `linear-gradient(90deg, ${ACTION_COLOR.call} 0.0% 40.0%, ${ACTION_COLOR.fold} 40.0% 100.0%)`,
    )
  })

  it('monta o range de quem entrou no pote, com pesos, para a API de equity', () => {
    const range = {
      AA: { allin: 1 },
      AKs: { raise: 0.4, fold: 0.6 },
      QQ: { raise: 0.5, call: 0.25, fold: 0.25 },
      K9o: { fold: 1 },
      '72o': { call: 1 },
    }

    expect(playedRange(range)).toBe('AA,AKs:0.4,QQ:0.75,72o')
    expect(playedRange({ K9o: { fold: 1 } })).toBe('')
  })

  it('soma os combos de cada ação', () => {
    expect(combosByAction({ AA: { raise: 1 }, AKo: { call: 0.5, fold: 0.5 }, '72o': { fold: 1 } })).toEqual(
      { allin: 0, raise: 6, call: 6, fold: 18 },
    )
  })

  it('formata frequências e números em português', () => {
    expect(describeFrequencies({ allin: 1 })).toBe('All-in 100%')
    expect(describeFrequencies({ fold: 0.6, call: 0.4 })).toBe('Call 40% · Fold 60%')
    expect(describeFrequencies({ raise: 0.5, call: 0.5 }, 'vs_CO')).toBe('3-bet 50% · Call 50%')
    expect(formatPercent(0.123)).toBe('12,3%')
    expect(formatNumber(11.75)).toBe('11,75')
    expect(formatNumber(6)).toBe('6')
  })

  it('monta o texto grande da recomendação', () => {
    expect(recommendationHeadline('allin', { allin: 1 }, 'open')).toBe('ALL-IN')
    expect(recommendationHeadline('raise', { raise: 1 }, 'open')).toBe('RAISE')
    expect(recommendationHeadline('raise', { raise: 1 }, 'vs_CO')).toBe('3-BET')
    expect(recommendationHeadline('mixed', { call: 0.4, fold: 0.6 }, 'vs_CO')).toBe('MISTO 40/60')
    expect(recommendationHeadline('mixed', { allin: 0.25, raise: 0.25, fold: 0.5 }, 'open')).toBe(
      'MISTO 25/25/50',
    )
  })

  it('explica a situação conforme a origem da tabela', () => {
    expect(scenarioHelp('open')).toContain('primeiro a entrar no pote')
    expect(scenarioHelp('vs_CO', 'solver')).toBe(
      'vs CO: essa posição deu all-in e quem estava entre vocês foldou.',
    )
    expect(scenarioHelp('vs_CO', 'reference')).toContain('abriu com raise')
    expect(scenarioHelp('vs_CO', 'custom')).toContain('abriu com raise')
  })

  it('marca nos seletores os stacks de referência e os personalizados', () => {
    const table = { reference_stacks: [25, 40], custom_spots: [{ stack: 40 }, { stack: 33 }] }

    expect(stackMark(10, table)).toEqual({})
    expect(stackMark(25, table)).toEqual({ mark: 'tabela de referência', markClass: 'bg-amber-400' })
    // O personalizado tem prioridade sobre a referência no mesmo stack.
    expect(stackMark(40, table)).toEqual({ mark: 'tem range personalizado' })
    expect(stackMark(33, table)).toEqual({ mark: 'tem range personalizado' })
  })
})
