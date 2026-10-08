import { useEffect, useMemo, useReducer, useState } from 'react'

import { ActionResult } from './components/ActionResult.tsx'
import { EquityPanel } from './components/EquityPanel.tsx'
import { HandInput } from './components/HandInput.tsx'
import { Legend } from './components/Legend.tsx'
import { RangeGrid } from './components/RangeGrid.tsx'
import { SpotSelector } from './components/SpotSelector.tsx'
import { useSpotData } from './hooks/useSpotData.ts'
import { formatNumber } from './lib/actions.ts'
import { getHealth, getSpots } from './lib/api.ts'
import { parseHand } from './lib/hands.ts'
import { buildQuery, currentTable, initialSpotState, spotReducer } from './lib/spotState.ts'
import type { RangeResponse } from './types.ts'

type ApiStatus = 'checking' | 'online' | 'offline'

const STATUS_LABEL: Record<ApiStatus, string> = {
  checking: 'Verificando API…',
  online: 'API online',
  offline: 'API offline',
}

const STATUS_DOT: Record<ApiStatus, string> = {
  checking: 'bg-amber-400',
  online: 'bg-emerald-400',
  offline: 'bg-red-500',
}

/** Abaixo disso o modelo "só o primeiro call" satura (ver Decisões no PLANO.md). */
const SATURATED_BELOW_BB = 5

const panel = 'rounded-xl border border-slate-800 bg-slate-900 p-4'

function StackWarning({ spot, maxStack }: { spot: RangeResponse; maxStack: number }) {
  if (spot.stack_requested > maxStack * 1.25) {
    return (
      <p className="rounded-md border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-200">
        Com {formatNumber(spot.stack_requested)} bb o jogo já não é só all-in ou fold. O que
        aparece aqui é a tabela de {formatNumber(spot.stack_used)} bb, a maior disponível.
      </p>
    )
  }
  if (spot.stack_used < SATURATED_BELOW_BB) {
    return (
      <p className="rounded-md border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-200">
        Com menos de {SATURATED_BELOW_BB} bb a simplificação do modelo (só o primeiro call conta)
        pesa mais e os ranges saem bem largos. Use com cautela.
      </p>
    )
  }
  return null
}

export default function App() {
  const [state, dispatch] = useReducer(spotReducer, initialSpotState)
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
  const [spotsError, setSpotsError] = useState<string | null>(null)
  const [spotsLoaded, setSpotsLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal).then(
      (health) => setApiStatus(health.status === 'ok' ? 'online' : 'offline'),
      () => {
        if (!controller.signal.aborted) setApiStatus('offline')
      },
    )
    getSpots(controller.signal).then(
      (spots) => {
        dispatch({ type: 'tablesLoaded', tables: spots.tables })
        setSpotsError(null)
        setSpotsLoaded(true)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setSpotsError(error instanceof Error ? error.message : 'Erro inesperado.')
      },
    )
    return () => controller.abort()
  }, [attempt])

  const parsed = useMemo(() => parseHand(state.handText), [state.handText])
  const handClass = parsed.status === 'valid' ? parsed.handClass : null
  const table = currentTable(state)
  const query = buildQuery(state)
  const { range, lookup, loading, error } = useSpotData(query, handClass)

  function retry() {
    setApiStatus('checking')
    setSpotsError(null)
    setAttempt((count) => count + 1)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-4 sm:px-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Poker Range Helper</h1>
          <p className="text-sm text-slate-400">Push/fold para MTT · stacks de 3 a 20 bb</p>
        </div>
        <span className="flex shrink-0 items-center gap-2 text-sm text-slate-300">
          <span className={`size-2.5 rounded-full ${STATUS_DOT[apiStatus]}`} aria-hidden />
          {STATUS_LABEL[apiStatus]}
        </span>
      </header>

      <main className="mx-auto max-w-6xl px-3 pb-10 sm:px-4">
        {spotsError && (
          <div role="alert" className="rounded-xl border border-red-500/60 bg-red-950/40 p-4">
            <p className="font-semibold text-red-300">Não foi possível carregar os ranges</p>
            <p className="mt-1 text-red-200">{spotsError}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-400"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {!spotsError && !spotsLoaded && <p className="text-slate-400">Carregando ranges…</p>}

        {!spotsError && spotsLoaded && !table && (
          <p className={panel}>
            A API não tem nenhum range carregado. Gere os arquivos com{' '}
            <code className="text-emerald-300">python -m app.solver.generate</code> e reinicie o
            backend.
          </p>
        )}

        {!spotsError && table && (
          <div className="grid gap-4 lg:grid-cols-[23rem_minmax(0,1fr)] lg:items-start">
            <div className="space-y-4">
              <section className={panel} aria-label="Spot">
                <SpotSelector state={state} table={table} dispatch={dispatch} />
              </section>
              <section className={panel} aria-label="Mão">
                <HandInput
                  value={state.handText}
                  parsed={parsed}
                  onChange={(handText) => dispatch({ type: 'setHand', handText })}
                />
              </section>
            </div>

            <div className="space-y-4">
              <ActionResult
                hand={parsed}
                lookup={lookup}
                range={range}
                loading={loading}
                error={error}
              />
              {range && !error && <StackWarning spot={range} maxStack={Math.max(...table.stacks)} />}
              <EquityPanel query={query} hand={parsed} />
              <section className={`${panel} space-y-3`} aria-label="Range">
                <RangeGrid
                  range={error ? null : (range?.range ?? null)}
                  selectedHand={handClass}
                  onSelect={(hand) => dispatch({ type: 'setHand', handText: hand })}
                  loading={loading}
                />
                <Legend range={error ? null : range} />
              </section>
            </div>
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-3 pb-8 text-xs text-slate-500 sm:px-4">
        Modelo simplificado: Nash aproximado em chipEV, com stacks iguais, ante de 0,125 bb por
        jogador e só o primeiro call considerado (sem pots multiway). Não leva em conta ICM.
      </footer>
    </div>
  )
}
