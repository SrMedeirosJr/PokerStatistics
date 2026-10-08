import { describe, expect, it } from 'vitest'

import {
  ACTION_COLOR,
  activeAction,
  cellBackground,
  describeFrequencies,
  formatNumber,
  formatPercent,
  scenarioLabel,
  weightedRange,
} from './actions.ts'

describe('ações', () => {
  it('define a ação ativa e o rótulo pela situação', () => {
    expect(activeAction('open')).toBe('allin')
    expect(activeAction('vs_CO')).toBe('call')
    expect(scenarioLabel('open')).toBe('Open')
    expect(scenarioLabel('vs_UTG1')).toBe('vs UTG1')
  })

  it('pinta ação pura com cor sólida', () => {
    expect(cellBackground({ allin: 1 })).toBe(ACTION_COLOR.allin)
    expect(cellBackground({ call: 1 })).toBe(ACTION_COLOR.call)
    expect(cellBackground({ fold: 1 })).toBe(ACTION_COLOR.fold)
  })

  it('pinta frequência mista com faixas proporcionais', () => {
    expect(cellBackground({ call: 0.4, fold: 0.6 })).toBe(
      `linear-gradient(90deg, ${ACTION_COLOR.call} 0.0% 40.0%, ${ACTION_COLOR.fold} 40.0% 100.0%)`,
    )
  })

  it('monta o range com pesos para a API de equity', () => {
    const range = {
      AA: { allin: 1 },
      AKs: { allin: 0.4, fold: 0.6 },
      K9o: { fold: 1 },
      '72o': { call: 1 },
    }

    expect(weightedRange(range, 'allin')).toBe('AA,AKs:0.4')
    expect(weightedRange(range, 'call')).toBe('72o')
    expect(weightedRange({ K9o: { fold: 1 } }, 'allin')).toBe('')
  })

  it('formata frequências e números em português', () => {
    expect(describeFrequencies({ allin: 1 })).toBe('All-in 100%')
    expect(describeFrequencies({ fold: 0.6, call: 0.4 })).toBe('Call 40% · Fold 60%')
    expect(formatPercent(0.123)).toBe('12,3%')
    expect(formatNumber(11.75)).toBe('11,75')
    expect(formatNumber(6)).toBe('6')
  })
})
