import type { Dispatch } from 'react'

import { formatNumber, scenarioLabel } from '../lib/actions.ts'
import { chipsStack, type SpotAction, type SpotState } from '../lib/spotState.ts'
import type { TableInfo } from '../types.ts'
import { ChoiceGroup } from './ChoiceGroup.tsx'

interface SpotSelectorProps {
  state: SpotState
  table: TableInfo
  dispatch: Dispatch<SpotAction>
}

const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none'

/** Seletores do spot: jogadores, stack (em bb ou fichas), posição e situação. */
export function SpotSelector({ state, table, dispatch }: SpotSelectorProps) {
  const converted = chipsStack(state)

  return (
    <div className="space-y-4">
      <ChoiceGroup
        label="Jogadores na mesa"
        options={state.tables.map((item) => ({ value: item.players, label: String(item.players) }))}
        value={state.players}
        onChange={(players) => dispatch({ type: 'setPlayers', players })}
      />

      <div className="space-y-2">
        <ChoiceGroup
          label="Stack (big blinds)"
          options={table.stacks.map((stack) => ({ value: stack, label: formatNumber(stack) }))}
          value={state.chipsMode ? null : state.stack}
          onChange={(stack) => dispatch({ type: 'setStack', stack })}
        />
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={state.chipsMode}
            onChange={(event) => dispatch({ type: 'setChipsMode', enabled: event.target.checked })}
            className="size-4 accent-emerald-500"
          />
          Informar em fichas
        </label>
        {state.chipsMode && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              Fichas
              <input
                type="text"
                inputMode="decimal"
                placeholder="ex.: 12500"
                value={state.chips}
                onChange={(event) => dispatch({ type: 'setChips', chips: event.target.value })}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="text-xs text-slate-400">
              Big blind
              <input
                type="text"
                inputMode="decimal"
                placeholder="ex.: 1000"
                value={state.bigBlind}
                onChange={(event) => dispatch({ type: 'setBigBlind', bigBlind: event.target.value })}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <p className="col-span-2 text-sm text-slate-300" aria-live="polite">
              {converted === null
                ? 'Preencha as fichas e o valor do big blind.'
                : `= ${formatNumber(converted)} bb`}
            </p>
          </div>
        )}
      </div>

      <ChoiceGroup
        label="Sua posição"
        options={table.positions.map((position) => ({ value: position, label: position }))}
        value={state.position}
        onChange={(position) => dispatch({ type: 'setPosition', position })}
      />

      <ChoiceGroup
        label="Situação"
        options={(table.scenarios[state.position] ?? []).map((scenario) => ({
          value: scenario,
          label: scenarioLabel(scenario),
        }))}
        value={state.scenario}
        onChange={(scenario) => dispatch({ type: 'setScenario', scenario })}
      />
      <p className="text-xs text-slate-500">
        {state.scenario === 'open'
          ? 'Open: todos antes de você foldaram. Você decide entre all-in e fold.'
          : `${scenarioLabel(state.scenario)}: essa posição deu all-in e quem estava entre vocês foldou. Você decide entre call e fold.`}
      </p>
    </div>
  )
}
