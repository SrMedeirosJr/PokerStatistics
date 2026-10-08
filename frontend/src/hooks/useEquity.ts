import { useEffect, useState } from 'react'

import { weightedRange } from '../lib/actions.ts'
import { getRange, postEquity } from '../lib/api.ts'
import type { EquityResponse, RangeResponse, SpotQuery } from '../types.ts'
import { DEBOUNCE_MS } from './useSpotData.ts'

export const EQUITY_ITERATIONS = 20_000
/** Semente fixa: o mesmo spot e a mesma mão mostram sempre o mesmo número. */
const EQUITY_SEED = 1

export interface EquityData {
  /** Posição que deu all-in, ou null quando a situação é 'open'. */
  pusher: string | null
  /** Range de all-in dessa posição, contra o qual a equity foi calculada. */
  pusherRange: RangeResponse | null
  equity: EquityResponse | null
  loading: boolean
  error: string | null
}

interface Loaded {
  key: string
  pusherRange: RangeResponse | null
  equity: EquityResponse | null
  error: string | null
}

export function pusherOf(scenario: string): string | null {
  return scenario.startsWith('vs_') ? scenario.slice('vs_'.length) : null
}

/**
 * Em situações 'vs_{POS}', busca o range de all-in daquela posição e calcula a equity
 * da mão do herói contra ele. `hero` é a mão como digitada ('A9o' ou 'Ah9d').
 */
export function useEquity(query: SpotQuery | null, hero: string | null): EquityData {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const pusher = query ? pusherOf(query.scenario) : null
  const key = query && pusher && hero ? JSON.stringify([query, hero]) : null

  useEffect(() => {
    if (!query || !pusher || !hero || key === null) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const pusherRange = await getRange(
          { ...query, position: pusher, scenario: 'open' },
          controller.signal,
        )
        const equity = await postEquity(
          {
            hero,
            villain_range: weightedRange(pusherRange.range, 'allin'),
            iterations: EQUITY_ITERATIONS,
            seed: EQUITY_SEED,
          },
          controller.signal,
        )
        setLoaded({ key, pusherRange, equity, error: null })
      } catch (error) {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Erro inesperado.'
        setLoaded({ key, pusherRange: null, equity: null, error: message })
      }
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // `key` resume `query` e `hero`, cujos objetos mudam de identidade a cada render.
  }, [key])

  if (key === null) {
    return { pusher, pusherRange: null, equity: null, loading: false, error: null }
  }
  const current = loaded?.key === key
  return {
    pusher,
    pusherRange: current ? (loaded?.pusherRange ?? null) : null,
    equity: current ? (loaded?.equity ?? null) : null,
    loading: !current,
    error: current ? (loaded?.error ?? null) : null,
  }
}
