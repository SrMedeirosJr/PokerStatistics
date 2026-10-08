import { useEffect, useState } from 'react'

import { getRange, lookupHand } from '../lib/api.ts'
import type { LookupResponse, RangeResponse, SpotQuery } from '../types.ts'

export const DEBOUNCE_MS = 200

export interface SpotData {
  /** Range do spot (a resposta de /api/lookup também traz o range completo). */
  range: RangeResponse | null
  /** Recomendação para a mão atual; null sem mão válida ou enquanto carrega. */
  lookup: LookupResponse | null
  loading: boolean
  error: string | null
}

interface Loaded {
  key: string
  data: RangeResponse | LookupResponse | null
  error: string | null
}

function isLookup(data: RangeResponse | LookupResponse): data is LookupResponse {
  return 'hand' in data
}

/**
 * Consulta /api/lookup (com mão) ou /api/ranges (sem mão) sempre que o spot ou a mão
 * mudam, com debounce. Enquanto a nova resposta não chega, o range anterior continua
 * disponível para a tela não piscar.
 */
export function useSpotData(query: SpotQuery | null, hand: string | null): SpotData {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const key = query ? JSON.stringify([query, hand]) : null

  useEffect(() => {
    if (!query || key === null) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const pending = hand
        ? lookupHand(query, hand, controller.signal)
        : getRange(query, controller.signal)
      pending.then(
        (data) => setLoaded({ key, data, error: null }),
        (error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : 'Erro inesperado.'
          setLoaded({ key, data: null, error: message })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // `key` resume `query` e `hand`, cujos objetos mudam de identidade a cada render.
  }, [key])

  if (key === null) return { range: null, lookup: null, loading: false, error: null }
  const current = loaded?.key === key
  const data = loaded?.data ?? null
  return {
    range: data,
    lookup: current && data && isLookup(data) && data.hand === hand ? data : null,
    loading: !current,
    error: current ? (loaded?.error ?? null) : null,
  }
}
