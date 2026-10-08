import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { useSpotData } from '../hooks/useSpotData.ts'
import {
  formatNumber,
  recommendationHeadline,
  scenarioHelp,
  scenarioLabel,
} from '../lib/actions.ts'
import { parseHand } from '../lib/hands.ts'
import {
  blindInfo,
  handsUntil,
  loadTournament,
  saveTournament,
  tournamentQuery,
  tournamentReducer,
} from '../lib/tournament.ts'
import type { TableInfo } from '../types.ts'
import { ChoiceGroup } from './ChoiceGroup.tsx'
import { HandInput } from './HandInput.tsx'
import { SpotResult } from './SpotResult.tsx'

interface TournamentTrackerProps {
  tables: TableInfo[]
  /** Muda quando os ranges personalizados mudam, para refazer a consulta. */
  version: number
}

const panel = 'rounded-xl border border-slate-800 bg-slate-900 p-4'
const fieldLabel = 'mb-1.5 block text-xs font-medium tracking-wide text-slate-400 uppercase'
const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none'
const secondaryButton =
  'rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40'

const FIELDS = [
  { field: 'chips', label: 'Minhas fichas', placeholder: 'ex.: 58416' },
  { field: 'smallBlind', label: 'Small blind', placeholder: 'ex.: 500' },
  { field: 'bigBlind', label: 'Big blind', placeholder: 'ex.: 1000' },
  { field: 'ante', label: 'Ante', placeholder: 'ex.: 100' },
] as const

function inHands(count: number): string {
  if (count === 0) return 'nesta mão'
  return count === 1 ? 'na próxima mão' : `em ${count} mãos`
}

/**
 * Acompanha um torneio mão a mão: a posição roda sozinha a cada "Próxima mão", o stack
 * em bb sai das fichas e do blind atuais, e a tela mostra quantas mãos faltam para os
 * blinds chegarem. A mão de cada rodada continua sendo digitada pelo jogador.
 */
export function TournamentTracker({ tables, version }: TournamentTrackerProps) {
  const [state, dispatch] = useReducer(tournamentReducer, undefined, () =>
    loadTournament(window.localStorage),
  )
  const [confirmingReset, setConfirmingReset] = useState(false)
  const handInput = useRef<HTMLInputElement>(null)

  useEffect(() => dispatch({ type: 'sync', tables }), [tables])
  useEffect(() => saveTournament(window.localStorage, state), [state])

  const table = tables.find((item) => item.players === state.players) ?? tables[0]
  const parsed = useMemo(() => parseHand(state.handText), [state.handText])
  const handClass = parsed.status === 'valid' ? parsed.handClass : null
  const query = tournamentQuery(state, tables)
  const data = useSpotData(query, handClass, version)
  const blinds = blindInfo(state)

  if (!table) return null
  const untilBigBlind = handsUntil(table.positions, state.position, 'BB')
  const untilSmallBlind = handsUntil(table.positions, state.position, 'SB')

  function nextHand() {
    const record =
      handClass && blinds.stackBb !== null
        ? {
            number: state.handNumber,
            position: state.position,
            hand: handClass,
            action: data.lookup
              ? recommendationHeadline(
                  data.lookup.recommendation,
                  data.lookup.frequencies,
                  data.lookup.scenario,
                )
              : 'sem consulta',
            stackBb: blinds.stackBb,
          }
        : null
    dispatch({ type: 'nextHand', tables, record })
    handInput.current?.focus()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[23rem_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4">
        <section className={`${panel} space-y-4`} aria-label="Torneio">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-100" data-testid="hand-number">
              Mão {state.handNumber}
            </h2>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => dispatch({ type: 'previousHand', tables })}
                disabled={state.handNumber <= 1}
                className={secondaryButton}
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={nextHand}
                className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Próxima mão
              </button>
            </div>
          </div>

          <ChoiceGroup
            label="Jogadores na mesa"
            options={tables.map((item) => ({ value: item.players, label: String(item.players) }))}
            value={state.players}
            onChange={(players) => dispatch({ type: 'setPlayers', players, tables })}
          />

          <div>
            <div className="grid grid-cols-2 gap-2">
              {FIELDS.map(({ field, label, placeholder }) => (
                <label key={field} className="text-xs text-slate-400">
                  {label}
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={placeholder}
                    value={state[field]}
                    onChange={(event) =>
                      dispatch({ type: 'setField', field, value: event.target.value })
                    }
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-slate-300" data-testid="tournament-stack" aria-live="polite">
              {blinds.stackBb === null
                ? 'Informe suas fichas e o big blind para ver a recomendação.'
                : `Seu stack: ${formatNumber(blinds.stackBb)} bb`}
            </p>
          </div>

          <div>
            <ChoiceGroup
              label="Sua posição nesta mão"
              options={table.positions.map((position) => ({ value: position, label: position }))}
              value={state.position}
              onChange={(position) => dispatch({ type: 'setPosition', position, tables })}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Ela avança sozinha a cada mão: BB → SB → BTN → CO… Se alguém cair ou entrar na mesa,
              ajuste os jogadores e a posição.
            </p>
          </div>

          <div>
            <ChoiceGroup
              label="Situação"
              options={(table.scenarios[state.position] ?? []).map((scenario) => ({
                value: scenario,
                label: scenarioLabel(scenario),
              }))}
              value={state.scenario}
              onChange={(scenario) => dispatch({ type: 'setScenario', scenario })}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              {scenarioHelp(state.scenario, data.range?.source)}
            </p>
          </div>
        </section>

        <section className={panel} aria-label="Mãos até o blind">
          <h2 className={fieldLabel}>Mãos até o blind</h2>
          <dl className="space-y-1 text-sm text-slate-300">
            <div className="flex justify-between gap-3">
              <dt>Você é o BB</dt>
              <dd data-testid="until-bb" className="font-semibold text-slate-100">
                {inHands(untilBigBlind)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Você é o SB</dt>
              <dd data-testid="until-sb" className="font-semibold text-slate-100">
                {inHands(untilSmallBlind)}
              </dd>
            </div>
            {blinds.orbitCost !== null && (
              <div className="flex justify-between gap-3">
                <dt>Uma volta na mesa custa</dt>
                <dd data-testid="orbit-cost" className="font-semibold text-slate-100">
                  {formatNumber(blinds.orbitCost)} fichas
                </dd>
              </div>
            )}
            {blinds.orbits !== null && (
              <div className="flex justify-between gap-3">
                <dt>Seu stack paga</dt>
                <dd data-testid="orbits" className="font-semibold text-slate-100">
                  {formatNumber(Math.round(blinds.orbits * 10) / 10)} voltas
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className={panel} aria-label="Mão">
          <HandInput
            value={state.handText}
            parsed={parsed}
            onChange={(handText) => dispatch({ type: 'setHand', handText })}
            onSubmit={nextHand}
            inputRef={handInput}
          />
          <p className="mt-2 text-xs text-slate-500">
            A recomendação aparece enquanto você digita. Enter passa para a próxima mão.
          </p>
        </section>
      </div>

      <div className="space-y-4">
        <SpotResult
          query={query}
          hand={parsed}
          data={data}
          version={version}
          onSelectHand={(hand) => dispatch({ type: 'setHand', handText: hand })}
        />

        <section className={`${panel} space-y-2`} aria-label="Mãos da sessão">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">Mãos da sessão</h2>
            {confirmingReset ? (
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'reset' })
                  setConfirmingReset(false)
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
              >
                Confirmar: zerar sessão
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                className={secondaryButton}
              >
                Nova sessão
              </button>
            )}
          </div>
          {state.history.length === 0 ? (
            <p className="text-sm text-slate-400">
              As mãos que você digitar aparecem aqui quando passar para a próxima.
            </p>
          ) : (
            <ol className="divide-y divide-slate-800 text-sm">
              {state.history.map((record) => (
                <li key={record.number} className="flex flex-wrap gap-x-3 gap-y-0.5 py-1.5">
                  <span className="w-14 text-slate-500">Mão {record.number}</span>
                  <span className="w-12 text-slate-300">{record.position}</span>
                  <span className="w-10 font-mono font-semibold text-slate-100">{record.hand}</span>
                  <span className="font-semibold text-slate-100">{record.action}</span>
                  <span className="ml-auto text-slate-400">{formatNumber(record.stackBb)} bb</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
