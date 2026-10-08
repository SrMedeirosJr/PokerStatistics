/** API falsa para os testes: responde às rotas do backend a partir de ranges pequenos. */

import { vi } from 'vitest'

import { comboCount, HAND_GRID } from '../lib/hands.ts'
import type { Frequencies, RangeMap, TableInfo } from '../types.ts'

const STACKS = [3, 4, 5, 6, 7, 8, 10, 12, 15, 20]

function table(players: number, positions: string[]): TableInfo {
  const scenarios = Object.fromEntries(
    positions.map((position, index) => {
      const facing = positions.slice(0, index).map((pusher) => `vs_${pusher}`)
      return [position, position === 'BB' ? facing : ['open', ...facing]]
    }),
  )
  return { players, stacks: STACKS, positions, scenarios }
}

export const TABLES: TableInfo[] = [
  table(2, ['SB', 'BB']),
  table(6, ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']),
  table(8, ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']),
]

/** Mãos que dão all-in em 'open'; contra all-in, AA/KK pagam e A9o é mista (40% call). */
const OPEN_HANDS = ['AA', 'KK', 'AKs', 'K9o']
const CALL_HANDS = ['AA', 'KK']
const MIXED_CALLS: Record<string, number> = { A9o: 0.4 }

function fakeRange(scenario: string): RangeMap {
  const open = scenario === 'open'
  return Object.fromEntries(
    HAND_GRID.flat().map((hand): [string, Frequencies] => {
      if (open) return [hand, OPEN_HANDS.includes(hand) ? { allin: 1 } : { fold: 1 }]
      if (hand in MIXED_CALLS) {
        const call = MIXED_CALLS[hand]
        return [hand, { call, fold: 1 - call }]
      }
      return [hand, CALL_HANDS.includes(hand) ? { call: 1 } : { fold: 1 }]
    }),
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function spotResponse(params: URLSearchParams): Record<string, unknown> {
  const scenario = params.get('scenario') ?? 'open'
  const requested = params.has('stack')
    ? Number(params.get('stack'))
    : Number(params.get('chips')) / Number(params.get('big_blind'))
  const used = STACKS.reduce((best, stack) =>
    Math.abs(stack - requested) < Math.abs(best - requested) ? stack : best,
  )
  const range = fakeRange(scenario)
  const active = scenario === 'open' ? 'allin' : 'call'
  const combos = Object.entries(range).reduce(
    (sum, [hand, frequencies]) => sum + comboCount(hand) * (frequencies[active] ?? 0),
    0,
  )
  return {
    spot_id: `mtt_${params.get('players')}max_${used}bb_${params.get('position')}_${scenario}`,
    players: Number(params.get('players')),
    position: params.get('position'),
    scenario,
    stack_requested: requested,
    stack_used: used,
    range_pct: Math.round((1000 * combos) / 1326) / 10,
    combos: Math.round(combos * 10) / 10,
    range,
  }
}

export interface FakeApi {
  /** Caminho + query de cada chamada feita, na ordem. */
  calls: string[]
  /** Corpo (JSON) de cada POST em /api/equity, na ordem. */
  equityRequests: Record<string, unknown>[]
  /** A próxima chamada cujo caminho comece com `path` responde este erro. */
  failNext: (path: string, status: number, detail: string) => void
  /** Simula o backend fora do ar (fetch rejeita) enquanto estiver ligado. */
  setOffline: (offline: boolean) => void
}

export function installFakeApi(): FakeApi {
  const calls: string[] = []
  const equityRequests: Record<string, unknown>[] = []
  const failures: { path: string; status: number; detail: string }[] = []
  let offline = false

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost')
    calls.push(url.pathname + url.search)
    if (offline) throw new TypeError('Failed to fetch')
    if (url.pathname === '/api/equity' && typeof init?.body === 'string') {
      equityRequests.push(JSON.parse(init.body) as Record<string, unknown>)
    }

    const failure = failures.findIndex((item) => url.pathname.startsWith(item.path))
    if (failure >= 0) {
      const [{ status, detail }] = failures.splice(failure, 1)
      return json({ detail }, status)
    }

    switch (url.pathname) {
      case '/api/health':
        return json({ status: 'ok' })
      case '/api/spots':
        return json({ tables: TABLES })
      case '/api/ranges':
        return json(spotResponse(url.searchParams))
      case '/api/lookup': {
        const spot = spotResponse(url.searchParams)
        const hand = url.searchParams.get('hand') ?? ''
        const frequencies = (spot.range as RangeMap)[hand]
        const [action, frequency] = Object.entries(frequencies).sort((a, b) => b[1] - a[1])[0]
        return json({
          ...spot,
          hand,
          recommendation: frequency >= 0.8 ? action : 'mixed',
          frequencies,
        })
      }
      case '/api/equity':
        return json({ win: 0.47, tie: 0.02, lose: 0.51, equity: 0.48 })
      default:
        return json({ detail: 'Not Found' }, 404)
    }
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    calls,
    equityRequests,
    failNext: (path, status, detail) => failures.push({ path, status, detail }),
    setOffline: (value) => {
      offline = value
    },
  }
}
