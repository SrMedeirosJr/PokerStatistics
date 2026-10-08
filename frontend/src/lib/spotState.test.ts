import { describe, expect, it } from 'vitest'

import type { TableInfo } from '../types.ts'
import {
  buildQuery,
  chipsStack,
  initialSpotState,
  parseAmount,
  type SpotAction,
  spotReducer,
  type SpotState,
} from './spotState.ts'

const STACKS = [3, 4, 5, 6, 7, 8, 10, 12, 15, 20]

function table(players: number, positions: string[]): TableInfo {
  const scenarios = Object.fromEntries(
    positions.map((position, index) => {
      const facing = positions.slice(0, index).map((pusher) => `vs_${pusher}`)
      return [position, position === 'BB' ? facing : ['open', ...facing]]
    }),
  )
  return { players, stacks: STACKS, positions, scenarios, custom_spots: [] }
}

const TABLES = [
  table(2, ['SB', 'BB']),
  table(6, ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']),
  table(8, ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']),
]

function run(...actions: SpotAction[]): SpotState {
  return actions.reduce(spotReducer, initialSpotState)
}

const loaded: SpotAction = { type: 'tablesLoaded', tables: TABLES }

describe('spotReducer', () => {
  it('mantém o spot inicial quando ele existe nos dados', () => {
    expect(run(loaded)).toMatchObject({ players: 8, stack: 10, position: 'CO', scenario: 'open' })
  })

  it('mantém a posição ao trocar de mesa quando ela existe', () => {
    expect(run(loaded, { type: 'setPlayers', players: 6 })).toMatchObject({
      players: 6,
      position: 'CO',
    })
  })

  it('escolhe uma posição válida quando a atual não existe na nova mesa', () => {
    const state = run(loaded, { type: 'setPosition', position: 'UTG' }, { type: 'setPlayers', players: 6 })

    expect(state.position).toBe('BTN')
    expect(run(loaded, { type: 'setPlayers', players: 2 }).position).toBe('SB')
  })

  it('troca a situação quando ela deixa de ser possível', () => {
    const facingHijack = run(
      loaded,
      { type: 'setPosition', position: 'BTN' },
      { type: 'setScenario', scenario: 'vs_HJ' },
    )
    expect(facingHijack.scenario).toBe('vs_HJ')

    // O LJ age antes do HJ, então não pode enfrentar um all-in dele.
    expect(spotReducer(facingHijack, { type: 'setPosition', position: 'LJ' }).scenario).toBe('open')
  })

  it('coloca o BB contra o SB, já que ele nunca abre o pote', () => {
    expect(run(loaded, { type: 'setPosition', position: 'BB' }).scenario).toBe('vs_SB')
  })

  it('seleciona um spot inteiro de uma vez', () => {
    const tables = TABLES.map((item) =>
      item.players === 6 ? { ...item, stacks: [...STACKS, 40] } : item,
    )
    const state = run(
      { type: 'tablesLoaded', tables },
      { type: 'setChipsMode', enabled: true },
      { type: 'selectSpot', players: 6, stack: 40, position: 'BB', scenario: 'vs_CO' },
    )

    expect(state).toMatchObject({
      players: 6,
      stack: 40,
      position: 'BB',
      scenario: 'vs_CO',
      chipsMode: false,
    })
  })

  it('escolher um stack nos botões sai do modo fichas', () => {
    const state = run(loaded, { type: 'setChipsMode', enabled: true }, { type: 'setStack', stack: 6 })

    expect(state).toMatchObject({ stack: 6, chipsMode: false })
  })
})

describe('parseAmount', () => {
  it.each([
    ['12500', 12500],
    ['12.500', 12500],
    ['1.250.000', 1250000],
    ['1,5', 1.5],
    ['1.5', 1.5],
    ['2.500,5', 2500.5],
    [' 400 ', 400],
  ])('lê %s como %d', (text, expected) => {
    expect(parseAmount(text)).toBe(expected)
  })

  it.each(['', 'abc', '0', '-5', '1e3', ',5'])('rejeita "%s"', (text) => {
    expect(parseAmount(text)).toBeNull()
  })
})

describe('buildQuery', () => {
  it('não consulta antes de carregar as mesas', () => {
    expect(buildQuery(initialSpotState)).toBeNull()
  })

  it('usa o stack dos botões', () => {
    expect(buildQuery(run(loaded, { type: 'setStack', stack: 6 }))).toEqual({
      players: 8,
      position: 'CO',
      scenario: 'open',
      stack: { stack: 6 },
    })
  })

  it('usa fichas e big blind quando os dois estão preenchidos', () => {
    const waiting = run(loaded, { type: 'setChipsMode', enabled: true }, { type: 'setChips', chips: '4700' })
    expect(buildQuery(waiting)).toBeNull()
    expect(chipsStack(waiting)).toBeNull()

    const ready = spotReducer(waiting, { type: 'setBigBlind', bigBlind: '400' })
    expect(buildQuery(ready)?.stack).toEqual({ chips: 4700, big_blind: 400 })
    expect(chipsStack(ready)).toBe(11.75)
  })
})
