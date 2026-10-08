/** API falsa para os testes: responde às rotas do backend a partir de ranges pequenos. */

import { vi } from 'vitest'

import { comboCount, HAND_GRID } from '../lib/hands.ts'
import type { CustomRange, CustomRangeInput, Frequencies, RangeMap, TableInfo } from '../types.ts'

const STACKS = [3, 4, 5, 6, 7, 8, 10, 12, 15, 20]
const REFERENCE_STACKS = [25, 40, 60, 100]
const HANDS = HAND_GRID.flat()
const PAIRS = ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22']

const TABLE_POSITIONS: Record<number, string[]> = {
  2: ['SB', 'BB'],
  6: ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
}

/** Mãos que dão all-in em 'open'; contra all-in, AA/KK pagam e A9o é mista (40% call). */
const OPEN_HANDS = ['AA', 'KK', 'AKs', 'K9o']
const CALL_HANDS = ['AA', 'KK']
const MIXED_CALLS: Record<string, number> = { A9o: 0.4 }

function solverRange(scenario: string): RangeMap {
  const open = scenario === 'open'
  return Object.fromEntries(
    HANDS.map((hand): [string, Frequencies] => {
      if (open) return [hand, OPEN_HANDS.includes(hand) ? { allin: 1 } : { fold: 1 }]
      if (hand in MIXED_CALLS) {
        const call = MIXED_CALLS[hand]
        return [hand, { call, fold: 1 - call }]
      }
      return [hand, CALL_HANDS.includes(hand) ? { call: 1 } : { fold: 1 }]
    }),
  )
}

/**
 * Tabela de referência falsa (stack fundo): em 'open' abre com raise; contra um raise,
 * 3-bet com AA/KK e call com QQ/AKs.
 */
const REFERENCE_OPEN = ['AA', 'KK', 'AKs', 'KTo']

function referenceRange(scenario: string): RangeMap {
  return Object.fromEntries(
    HANDS.map((hand): [string, Frequencies] => {
      if (scenario === 'open') {
        return [hand, REFERENCE_OPEN.includes(hand) ? { raise: 1 } : { fold: 1 }]
      }
      if (['AA', 'KK'].includes(hand)) return [hand, { raise: 1 }]
      return [hand, ['QQ', 'AKs'].includes(hand) ? { call: 1 } : { fold: 1 }]
    }),
  )
}

function playedCombos(range: RangeMap): number {
  return Object.entries(range).reduce(
    (sum, [hand, frequencies]) => sum + comboCount(hand) * (1 - (frequencies.fold ?? 0)),
    0,
  )
}

function sizeFields(range: RangeMap): { range_pct: number; combos: number } {
  const combos = playedCombos(range)
  return { range_pct: Math.round((1000 * combos) / 1326) / 10, combos: Math.round(combos * 10) / 10 }
}

function nearest(options: number[], value: number): number {
  return [...options]
    .sort((a, b) => a - b)
    .reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best))
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Só o necessário para os testes: mãos separadas por vírgula, 'QQ+' e peso com ':'. */
function parseRange(text: string): Record<string, number> | null {
  const hands: Record<string, number> = {}
  for (const token of text.split(',').map((part) => part.trim())) {
    const [body, weightText] = token.split(':')
    const weight = weightText === undefined ? 1 : Number(weightText)
    const expanded = body.endsWith('+') ? PAIRS.slice(0, PAIRS.indexOf(body.slice(0, -1)) + 1) : [body]
    if (expanded.length === 0 || expanded.some((hand) => !HANDS.includes(hand))) return null
    for (const hand of expanded) hands[hand] = weight
  }
  return hands
}

export interface FakeApi {
  /** Caminho + query de cada chamada feita, na ordem. */
  calls: string[]
  /** Corpo (JSON) de cada POST em /api/equity, na ordem. */
  equityRequests: Record<string, unknown>[]
  /** Ranges personalizados "salvos" na API falsa. */
  customRanges: CustomRange[]
  /** A próxima chamada cujo caminho comece com `path` responde este erro. */
  failNext: (path: string, status: number, detail: string) => void
  /** Simula o backend fora do ar (fetch rejeita) enquanto estiver ligado. */
  setOffline: (offline: boolean) => void
}

export function installFakeApi(): FakeApi {
  const calls: string[] = []
  const equityRequests: Record<string, unknown>[] = []
  const customRanges: CustomRange[] = []
  const failures: { path: string; status: number; detail: string }[] = []
  let offline = false
  let nextId = 1

  function tables(): TableInfo[] {
    return Object.entries(TABLE_POSITIONS).map(([count, positions]) => {
      const players = Number(count)
      const custom = customRanges.filter((item) => item.players === players)
      const scenarios = Object.fromEntries(
        positions.map((position, index) => {
          const facing = positions.slice(0, index).map((pusher) => `vs_${pusher}`)
          return [position, position === 'BB' ? facing : ['open', ...facing]]
        }),
      )
      return {
        players,
        stacks: [
          ...new Set([...STACKS, ...REFERENCE_STACKS, ...custom.map((item) => item.stack_bb)]),
        ].sort((a, b) => a - b),
        reference_stacks: REFERENCE_STACKS,
        positions,
        scenarios,
        custom_spots: custom.map((item) => ({
          id: item.id,
          name: item.name,
          stack: item.stack_bb,
          position: item.position,
          scenario: item.scenario,
        })),
      }
    })
  }

  function upsert(input: CustomRangeInput): { record: CustomRange; created: boolean } {
    const range: RangeMap = Object.fromEntries(
      HANDS.map((hand) => [hand, input.actions[hand] ?? { fold: 1 }]),
    )
    const situation = input.scenario === 'open' ? 'open' : `vs ${input.scenario.slice(3)}`
    const fields = {
      name: input.name.trim() || `${input.position} ${situation} ${input.stack_bb}bb`,
      players: input.players,
      stack_bb: input.stack_bb,
      position: input.position,
      scenario: input.scenario,
      actions: range,
      spot_id: `custom_${input.players}max_${input.stack_bb}bb_${input.position}_${input.scenario}`,
      ...sizeFields(range),
      updated_at: '2026-10-08T18:00:00Z',
    }
    const existing = customRanges.find(
      (item) =>
        item.players === input.players &&
        item.stack_bb === input.stack_bb &&
        item.position === input.position &&
        item.scenario === input.scenario,
    )
    if (existing) {
      Object.assign(existing, fields)
      return { record: existing, created: false }
    }
    const record = { id: nextId++, ...fields }
    customRanges.push(record)
    return { record, created: true }
  }

  function spotResponse(params: URLSearchParams): Record<string, unknown> {
    const players = Number(params.get('players'))
    const position = params.get('position') ?? ''
    const scenario = params.get('scenario') ?? 'open'
    const requested = params.has('stack')
      ? Number(params.get('stack'))
      : Number(params.get('chips')) / Number(params.get('big_blind'))
    const custom = customRanges.filter(
      (item) => item.players === players && item.position === position && item.scenario === scenario,
    )
    const used = nearest(
      [...STACKS, ...REFERENCE_STACKS, ...custom.map((item) => item.stack_bb)],
      requested,
    )
    const match = custom.find((item) => item.stack_bb === used)
    const reference = !match && REFERENCE_STACKS.includes(used)
    const range = match
      ? match.actions
      : reference
        ? referenceRange(scenario)
        : solverRange(scenario)
    const sizes = reference
      ? { raise: scenario === 'open' ? (position === 'SB' ? 3 : 2.2) : 6.6 }
      : {}
    const prefix = reference ? 'ref' : 'mtt'
    return {
      spot_id: match ? match.spot_id : `${prefix}_${players}max_${used}bb_${position}_${scenario}`,
      players,
      position,
      scenario,
      stack_requested: requested,
      stack_used: used,
      ...sizeFields(range),
      range,
      source: match ? 'custom' : reference ? 'reference' : 'solver',
      custom_id: match ? match.id : null,
      name: match ? match.name : null,
      sizes,
    }
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    calls.push(url.pathname + url.search)
    if (offline) throw new TypeError('Failed to fetch')
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    if (url.pathname === '/api/equity') equityRequests.push(body as Record<string, unknown>)

    const failure = failures.findIndex((item) => url.pathname.startsWith(item.path))
    if (failure >= 0) {
      const [{ status, detail }] = failures.splice(failure, 1)
      return json({ detail }, status)
    }

    const customId = /^\/api\/custom-ranges\/(\d+)$/.exec(url.pathname)
    if (customId && method === 'DELETE') {
      const index = customRanges.findIndex((item) => item.id === Number(customId[1]))
      if (index < 0) return json({ detail: 'Range personalizado não encontrado.' }, 404)
      customRanges.splice(index, 1)
      return new Response(null, { status: 204 })
    }

    switch (url.pathname) {
      case '/api/health':
        return json({ status: 'ok' })
      case '/api/spots':
        return json({ tables: tables() })
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
      case '/api/ranges/parse': {
        const text = (body as { text: string }).text
        const hands = parseRange(text)
        if (!hands) return json({ detail: `Trecho de range inválido: '${text}'.` }, 422)
        return json({ hands, combos: 0 })
      }
      case '/api/custom-ranges': {
        if (method === 'GET') return json(customRanges)
        const { record, created } = upsert(body as CustomRangeInput)
        return json(record, created ? 201 : 200)
      }
      case '/api/custom-ranges/import': {
        const results = (body as { ranges: CustomRangeInput[] }).ranges.map(upsert)
        const created = results.filter((result) => result.created).length
        return json({ created, updated: results.length - created })
      }
      default:
        return json({ detail: 'Not Found' }, 404)
    }
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    calls,
    equityRequests,
    customRanges,
    failNext: (path, status, detail) => failures.push({ path, status, detail }),
    setOffline: (value) => {
      offline = value
    },
  }
}
