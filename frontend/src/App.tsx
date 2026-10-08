import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'

import { HandInput } from './components/HandInput.tsx'
import { RangeEditor } from './components/RangeEditor.tsx'
import { SpotResult } from './components/SpotResult.tsx'
import { SpotSelector } from './components/SpotSelector.tsx'
import { TournamentTracker } from './components/TournamentTracker.tsx'
import { useSpotData } from './hooks/useSpotData.ts'
import { getHealth, getSpots } from './lib/api.ts'
import { parseHand } from './lib/hands.ts'
import { buildQuery, currentTable, initialSpotState, spotReducer } from './lib/spotState.ts'
import type { CustomRange } from './types.ts'

type ApiStatus = 'checking' | 'online' | 'offline'
type View = 'consult' | 'tournament' | 'editor'

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

const VIEWS: { id: View; label: string }[] = [
  { id: 'consult', label: 'Consultar' },
  { id: 'tournament', label: 'Torneio' },
  { id: 'editor', label: 'Meus ranges' },
]

const panel = 'rounded-xl border border-slate-800 bg-slate-900 p-4'

export default function App() {
  const [state, dispatch] = useReducer(spotReducer, initialSpotState)
  const [view, setView] = useState<View>('consult')
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
  const [spotsError, setSpotsError] = useState<string | null>(null)
  const [spotsLoaded, setSpotsLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Muda quando um range personalizado é salvo ou excluído, para refazer as consultas.
  const [dataVersion, setDataVersion] = useState(0)

  const loadSpots = useCallback(async (signal?: AbortSignal) => {
    try {
      const spots = await getSpots(signal)
      dispatch({ type: 'tablesLoaded', tables: spots.tables })
      setSpotsError(null)
      setSpotsLoaded(true)
    } catch (error) {
      if (signal?.aborted) return
      setSpotsError(error instanceof Error ? error.message : 'Erro inesperado.')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal).then(
      (health) => setApiStatus(health.status === 'ok' ? 'online' : 'offline'),
      () => {
        if (!controller.signal.aborted) setApiStatus('offline')
      },
    )
    void loadSpots(controller.signal)
    return () => controller.abort()
  }, [attempt, loadSpots])

  const parsed = useMemo(() => parseHand(state.handText), [state.handText])
  const handClass = parsed.status === 'valid' ? parsed.handClass : null
  const table = currentTable(state)
  const query = buildQuery(state)
  // A aba de torneio faz a própria consulta; aqui só enquanto a consulta está aberta.
  const data = useSpotData(view === 'consult' ? query : null, handClass, dataVersion)

  function retry() {
    setApiStatus('checking')
    setSpotsError(null)
    setAttempt((count) => count + 1)
  }

  function customRangesChanged() {
    setDataVersion((version) => version + 1)
    void loadSpots()
  }

  async function consultCustomRange(custom: CustomRange) {
    // Recarrega as mesas antes, para o stack do range já existir nos seletores.
    await loadSpots()
    dispatch({
      type: 'selectSpot',
      players: custom.players,
      stack: custom.stack_bb,
      position: custom.position,
      scenario: custom.scenario,
    })
    setView('consult')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-4 sm:px-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Poker Range Helper</h1>
          <p className="text-sm text-slate-400">
            MTT · push/fold de 3 a 20 bb · referência de 25 a 100 bb
          </p>
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
          <>
            <div role="tablist" aria-label="Modo" className="mb-4 flex gap-1 border-b border-slate-800">
              {VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={view === item.id}
                  onClick={() => setView(item.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-emerald-400 ${
                    view === item.id
                      ? 'border-emerald-400 text-slate-50'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {view === 'editor' && (
              <RangeEditor
                tables={state.tables}
                onChanged={customRangesChanged}
                onConsult={(custom) => void consultCustomRange(custom)}
              />
            )}

            {view === 'tournament' && (
              <TournamentTracker tables={state.tables} version={dataVersion} />
            )}

            {view === 'consult' && (
              <div className="grid gap-4 lg:grid-cols-[23rem_minmax(0,1fr)] lg:items-start">
                <div className="space-y-4">
                  <section className={panel} aria-label="Spot">
                    <SpotSelector
                      state={state}
                      table={table}
                      dispatch={dispatch}
                      source={data.range?.source}
                    />
                  </section>
                  <section className={panel} aria-label="Mão">
                    <HandInput
                      value={state.handText}
                      parsed={parsed}
                      onChange={(handText) => dispatch({ type: 'setHand', handText })}
                    />
                  </section>
                </div>

                <SpotResult
                  query={query}
                  hand={parsed}
                  data={data}
                  version={dataVersion}
                  onSelectHand={(hand) => dispatch({ type: 'setHand', handText: hand })}
                />
              </div>
            )}
          </>
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-3 pb-8 text-xs text-slate-500 sm:px-4">
        Até 20 bb: Nash aproximado em chipEV (stacks iguais, ante de 0,125 bb por jogador, só o
        primeiro call considerado, sem ICM). De 25 a 100 bb: tabelas de referência por heurística,
        não por solver. "Personalizado" marca os ranges que você mesmo salvou.
      </footer>
    </div>
  )
}
