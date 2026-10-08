import { describe, expect, it } from 'vitest'

import type { TableInfo } from '../types.ts'
import {
  blindInfo,
  handsUntil,
  initialTournamentState,
  loadTournament,
  nextPosition,
  previousPosition,
  saveTournament,
  STORAGE_KEY,
  type TournamentAction,
  tournamentQuery,
  tournamentReducer,
  type TournamentState,
} from './tournament.ts'

const EIGHT = ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']

function table(players: number, positions: string[]): TableInfo {
  const scenarios = Object.fromEntries(
    positions.map((position, index) => {
      const facing = positions.slice(0, index).map((pusher) => `vs_${pusher}`)
      return [position, position === 'BB' ? facing : ['open', ...facing]]
    }),
  )
  return { players, stacks: [10, 60], reference_stacks: [60], positions, scenarios, custom_spots: [] }
}

const TABLES = [table(2, ['SB', 'BB']), table(6, EIGHT.slice(2)), table(8, EIGHT)]

function run(...actions: TournamentAction[]): TournamentState {
  return actions.reduce(tournamentReducer, initialTournamentState)
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

describe('rotação de posição', () => {
  it('recua uma posição por mão: BB, SB, BTN, CO, ..., UTG e de volta ao BB', () => {
    const order = ['BB']
    for (let hand = 0; hand < 8; hand += 1) order.push(nextPosition(EIGHT, order.at(-1)!))

    expect(order).toEqual(['BB', 'SB', 'BTN', 'CO', 'HJ', 'LJ', 'UTG1', 'UTG', 'BB'])
  })

  it('alterna SB e BB no heads-up', () => {
    expect(nextPosition(['SB', 'BB'], 'SB')).toBe('BB')
    expect(nextPosition(['SB', 'BB'], 'BB')).toBe('SB')
  })

  it('volta para a posição da mão anterior', () => {
    for (const position of EIGHT) {
      expect(previousPosition(EIGHT, nextPosition(EIGHT, position))).toBe(position)
    }
  })

  it('conta as mãos até cada blind', () => {
    expect(handsUntil(EIGHT, 'BB', 'BB')).toBe(0)
    expect(handsUntil(EIGHT, 'UTG', 'BB')).toBe(1)
    expect(handsUntil(EIGHT, 'UTG', 'SB')).toBe(2)
    expect(handsUntil(EIGHT, 'BTN', 'BB')).toBe(6)
    // Quem acabou de ser BB só volta a ser depois da volta inteira.
    expect(handsUntil(EIGHT, 'SB', 'BB')).toBe(7)
    expect(handsUntil(EIGHT, 'SB', 'SB')).toBe(0)
    expect(handsUntil(EIGHT, 'BB', 'SB')).toBe(1)
  })
})

describe('tournamentReducer', () => {
  const tables = TABLES

  it('avança a mão: roda a posição, limpa a mão e guarda o histórico', () => {
    const record = { number: 1, position: 'SB', hand: 'KTo', action: 'RAISE', stackBb: 58.4 }
    const state = run(
      { type: 'setPosition', position: 'SB', tables },
      { type: 'setHand', handText: 'KTo' },
      { type: 'nextHand', tables, record },
    )

    expect(state).toMatchObject({ position: 'BTN', scenario: 'open', handNumber: 2, handText: '' })
    expect(state.history).toEqual([record])
  })

  it('ao chegar no BB a situação vira contra o SB', () => {
    const state = run(
      { type: 'setPosition', position: 'UTG', tables },
      { type: 'nextHand', tables, record: null },
    )

    expect(state).toMatchObject({ position: 'BB', scenario: 'vs_SB' })
    expect(state.history).toEqual([])
  })

  it('volta uma mão e descarta o que foi registrado depois', () => {
    const first = { number: 1, position: 'SB', hand: 'KTo', action: 'RAISE', stackBb: 58 }
    const second = { number: 2, position: 'BTN', hand: '72o', action: 'FOLD', stackBb: 58 }
    const state = run(
      { type: 'setPosition', position: 'SB', tables },
      { type: 'nextHand', tables, record: first },
      { type: 'nextHand', tables, record: second },
      { type: 'previousHand', tables },
    )

    expect(state).toMatchObject({ position: 'BTN', handNumber: 2 })
    expect(state.history).toEqual([first])
    expect(tournamentReducer(run(), { type: 'previousHand', tables })).toEqual(run())
  })

  it('mantém a posição ao trocar de mesa, quando ela existe', () => {
    const state = run(
      { type: 'setPosition', position: 'CO', tables },
      { type: 'setPlayers', players: 6, tables },
    )
    expect(state).toMatchObject({ players: 6, position: 'CO' })

    const headsUp = tournamentReducer(state, { type: 'setPlayers', players: 2, tables })
    expect(headsUp).toMatchObject({ players: 2, position: 'SB', scenario: 'open' })
  })

  it('limita o histórico e zera a sessão mantendo a mesa', () => {
    let state = run({ type: 'setPlayers', players: 6, tables })
    for (let hand = 1; hand <= 40; hand += 1) {
      const record = { number: hand, position: 'CO', hand: 'AA', action: 'RAISE', stackBb: 40 }
      state = tournamentReducer(state, { type: 'nextHand', tables, record })
    }
    expect(state.history).toHaveLength(30)
    expect(state.history[0].number).toBe(40)

    expect(tournamentReducer(state, { type: 'reset' })).toEqual({
      ...initialTournamentState,
      players: 6,
    })
  })
})

describe('blinds e consulta', () => {
  const filled = run(
    { type: 'setField', field: 'chips', value: '58416' },
    { type: 'setField', field: 'smallBlind', value: '500' },
    { type: 'setField', field: 'bigBlind', value: '1.000' },
    { type: 'setField', field: 'ante', value: '100' },
  )

  it('calcula stack em bb, custo da volta e quantas voltas o stack paga', () => {
    const info = blindInfo(filled)

    expect(info.stackBb).toBeCloseTo(58.416)
    // 500 + 1000 + 8 jogadores x 100 de ante.
    expect(info.orbitCost).toBe(2300)
    expect(info.orbits).toBeCloseTo(25.4, 1)
  })

  it('funciona sem ante e espera os campos obrigatórios', () => {
    const noAnte = tournamentReducer(filled, { type: 'setField', field: 'ante', value: '' })
    expect(blindInfo(noAnte).orbitCost).toBe(1500)

    expect(blindInfo(run())).toEqual({ stackBb: null, orbitCost: null, orbits: null })
    expect(tournamentQuery(run(), TABLES)).toBeNull()
  })

  it('consulta a API com fichas e big blind', () => {
    expect(tournamentQuery(filled, TABLES)).toEqual({
      players: 8,
      position: 'BB',
      scenario: 'vs_SB',
      stack: { chips: 58416, big_blind: 1000 },
    })
  })
})

describe('sessão salva no navegador', () => {
  it('salva e recarrega a sessão, sem a mão em andamento', () => {
    const storage = memoryStorage()
    const state = { ...initialTournamentState, position: 'CO', chips: '30000', handNumber: 7, handText: 'AKs' }

    saveTournament(storage, state)

    expect(loadTournament(storage)).toEqual({ ...state, handText: '' })
  })

  it('ignora dados corrompidos ou de outro formato', () => {
    expect(loadTournament(memoryStorage())).toEqual(initialTournamentState)
    expect(loadTournament(memoryStorage({ [STORAGE_KEY]: '{quebrado' }))).toEqual(
      initialTournamentState,
    )
    const odd = JSON.stringify({ players: 'oito', position: 5, handNumber: -3, history: [{ x: 1 }] })
    expect(loadTournament(memoryStorage({ [STORAGE_KEY]: odd }))).toEqual(initialTournamentState)
  })
})
