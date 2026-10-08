import { type ChangeEvent, useEffect, useMemo, useState } from 'react'

import {
  ACTION_COLOR,
  ACTION_LABEL,
  ACTION_ORDER,
  combosByAction,
  formatNumber,
  formatPercent,
  scenarioLabel,
} from '../lib/actions.ts'
import {
  CUSTOM_RANGES_EXPORT_URL,
  deleteCustomRange,
  importCustomRanges,
  listCustomRanges,
  parseRangeText,
  saveCustomRange,
} from '../lib/api.ts'
import { HAND_GRID, TOTAL_COMBOS } from '../lib/hands.ts'
import { parseAmount, validPosition, validScenario } from '../lib/spotState.ts'
import type { ActionName, CustomRange, RangeMap, TableInfo } from '../types.ts'
import { ChoiceGroup } from './ChoiceGroup.tsx'
import { CustomBadge } from './CustomBadge.tsx'
import { RangeGrid } from './RangeGrid.tsx'

interface RangeEditorProps {
  tables: TableInfo[]
  /** Chamado depois de salvar, excluir ou importar, para a consulta se atualizar. */
  onChanged: () => void
  /** Abre a consulta já no spot do range. */
  onConsult: (range: CustomRange) => void
}

interface Feedback {
  kind: 'ok' | 'error'
  text: string
}

const BRUSHES: ActionName[] = ['raise', 'call', 'allin', 'fold']

const panel = 'rounded-xl border border-slate-800 bg-slate-900 p-4'
const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none'
const fieldLabel = 'mb-1.5 block text-xs font-medium tracking-wide text-slate-400 uppercase'
const secondaryButton =
  'rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro inesperado.'
}

/** Só as mãos jogadas; o que não está aqui é fold. */
function playedHands(actions: RangeMap): RangeMap {
  return Object.fromEntries(
    Object.entries(actions).filter(([, frequencies]) => (frequencies.fold ?? 0) < 1),
  )
}

/** Editor de ranges personalizados: pintar o grid, colar um range, salvar e exportar. */
export function RangeEditor({ tables, onChanged, onConsult }: RangeEditorProps) {
  const [players, setPlayers] = useState(() =>
    tables.some((table) => table.players === 8) ? 8 : (tables[0]?.players ?? 8),
  )
  const [stackText, setStackText] = useState('40')
  const [position, setPosition] = useState('CO')
  const [scenario, setScenario] = useState('open')
  const [name, setName] = useState('')
  const [actions, setActions] = useState<RangeMap>({})
  const [brush, setBrush] = useState<ActionName>('raise')
  const [rangeText, setRangeText] = useState('')
  const [saved, setSaved] = useState<CustomRange[]>([])
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null)

  const table = tables.find((item) => item.players === players) ?? tables[0]
  const currentPosition = table ? validPosition(table, position) : position
  const currentScenario = table ? validScenario(table, currentPosition, scenario) : scenario

  const range = useMemo<RangeMap>(
    () => Object.fromEntries(HAND_GRID.flat().map((hand) => [hand, actions[hand] ?? { fold: 1 }])),
    [actions],
  )
  const combos = useMemo(() => combosByAction(range), [range])

  async function refresh() {
    try {
      setSaved(await listCustomRanges())
    } catch (error) {
      setFeedback({ kind: 'error', text: errorText(error) })
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    listCustomRanges(controller.signal).then(setSaved, (error: unknown) => {
      if (!controller.signal.aborted) setFeedback({ kind: 'error', text: errorText(error) })
    })
    return () => controller.abort()
  }, [])

  function paint(hand: string) {
    setActions((current) => {
      const next = { ...current }
      if (brush === 'fold') delete next[hand]
      else next[hand] = { [brush]: 1 }
      return next
    })
  }

  async function run(task: () => Promise<string>) {
    setBusy(true)
    setFeedback(null)
    try {
      setFeedback({ kind: 'ok', text: await task() })
    } catch (error) {
      setFeedback({ kind: 'error', text: errorText(error) })
    } finally {
      setBusy(false)
    }
  }

  function applyText() {
    void run(async () => {
      const parsed = await parseRangeText(rangeText)
      setActions((current) => {
        const next = { ...current }
        for (const [hand, weight] of Object.entries(parsed.hands)) {
          if (brush === 'fold') delete next[hand]
          else if (weight >= 1) next[hand] = { [brush]: 1 }
          else next[hand] = { [brush]: weight, fold: Math.round((1 - weight) * 1000) / 1000 }
        }
        return next
      })
      const count = Object.keys(parsed.hands).length
      return `${count} ${count === 1 ? 'mão marcada' : 'mãos marcadas'} como ${ACTION_LABEL[brush]}.`
    })
  }

  function save() {
    const stack = parseAmount(stackText)
    if (stack === null) {
      setFeedback({ kind: 'error', text: 'Informe o stack em big blinds (ex.: 40).' })
      return
    }
    void run(async () => {
      const record = await saveCustomRange({
        name,
        players,
        stack_bb: stack,
        position: currentPosition,
        scenario: currentScenario,
        actions,
      })
      setName(record.name)
      await refresh()
      onChanged()
      return `Range salvo: ${record.name}.`
    })
  }

  function load(record: CustomRange) {
    setPlayers(record.players)
    setStackText(formatNumber(record.stack_bb))
    setPosition(record.position)
    setScenario(record.scenario)
    setName(record.name)
    setActions(playedHands(record.actions))
    setFeedback({ kind: 'ok', text: `Editando: ${record.name}.` })
  }

  function remove(record: CustomRange) {
    setConfirmingDelete(null)
    void run(async () => {
      await deleteCustomRange(record.id)
      await refresh()
      onChanged()
      return `Range excluído: ${record.name}.`
    })
  }

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void run(async () => {
      let document: unknown
      try {
        document = JSON.parse(await file.text())
      } catch {
        throw new Error('O arquivo escolhido não é um JSON válido.')
      }
      const result = await importCustomRanges(document)
      await refresh()
      onChanged()
      return `Importação concluída: ${result.created} novo(s), ${result.updated} atualizado(s).`
    })
  }

  if (!table) {
    return <p className={panel}>Carregue os ranges do solver antes de criar os seus.</p>
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[23rem_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4">
        <section className={`${panel} space-y-4`} aria-label="Spot do range">
          <ChoiceGroup
            label="Jogadores na mesa"
            options={tables.map((item) => ({ value: item.players, label: String(item.players) }))}
            value={players}
            onChange={setPlayers}
          />
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <label className="text-xs text-slate-400">
              <span className={fieldLabel}>Stack (bb)</span>
              <input
                type="text"
                inputMode="decimal"
                value={stackText}
                onChange={(event) => setStackText(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-xs text-slate-400">
              <span className={fieldLabel}>Nome (opcional)</span>
              <input
                type="text"
                value={name}
                maxLength={80}
                placeholder="ex.: Open CO 40bb"
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <ChoiceGroup
            label="Posição"
            options={table.positions.map((item) => ({ value: item, label: item }))}
            value={currentPosition}
            onChange={setPosition}
          />
          <ChoiceGroup
            label="Situação"
            options={(table.scenarios[currentPosition] ?? []).map((item) => ({
              value: item,
              label: scenarioLabel(item),
            }))}
            value={currentScenario}
            onChange={setScenario}
          />
        </section>

        <section className={`${panel} space-y-3`} aria-label="Pintar o range">
          <div>
            <p className={fieldLabel}>Ação do pincel</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ação do pincel">
              {BRUSHES.map((action) => (
                <button
                  key={action}
                  type="button"
                  role="radio"
                  aria-checked={brush === action}
                  onClick={() => setBrush(action)}
                  style={{ backgroundColor: ACTION_COLOR[action] }}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                    brush === action ? 'ring-2 ring-amber-300' : 'opacity-60 hover:opacity-90'
                  }`}
                >
                  {ACTION_LABEL[action]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Clique ou arraste no grid para pintar as mãos com a ação escolhida.
            </p>
          </div>

          <div>
            <label htmlFor="range-text" className={fieldLabel}>
              Ou cole um range
            </label>
            <div className="flex gap-2">
              <input
                id="range-text"
                type="text"
                value={rangeText}
                placeholder="22+,A2s+,KTo+,T9s-65s"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setRangeText(event.target.value)}
                className={`${inputClass} font-mono`}
              />
              <button
                type="button"
                onClick={applyText}
                disabled={busy || rangeText.trim() === ''}
                className={secondaryButton}
              >
                Aplicar
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              As mãos do texto recebem a ação do pincel. Peso opcional com dois-pontos: A5s:0.5.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              Salvar range
            </button>
            <button
              type="button"
              onClick={() => setActions({})}
              disabled={busy}
              className={secondaryButton}
            >
              Limpar grid
            </button>
          </div>

          {feedback && (
            <p
              role={feedback.kind === 'error' ? 'alert' : 'status'}
              className={`text-sm ${feedback.kind === 'error' ? 'text-red-300' : 'text-emerald-300'}`}
            >
              {feedback.text}
            </p>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <section className={`${panel} space-y-3`} aria-label="Grid do range">
          <RangeGrid range={range} onPaint={paint} label="Grid do range em edição" />
          <p data-testid="editor-summary" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
            {ACTION_ORDER.map((action) => (
              <span key={action} className="flex items-center gap-1.5">
                <span
                  className="size-3.5 rounded-sm"
                  style={{ background: ACTION_COLOR[action] }}
                  aria-hidden
                />
                {ACTION_LABEL[action]} {formatPercent(combos[action] / TOTAL_COMBOS)}
              </span>
            ))}
          </p>
        </section>

        <section className={`${panel} space-y-3`} aria-label="Ranges salvos">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">Ranges salvos</h2>
            <div className="flex flex-wrap gap-2">
              <a href={CUSTOM_RANGES_EXPORT_URL} download className={secondaryButton}>
                Exportar JSON
              </a>
              <label className={`${secondaryButton} cursor-pointer`}>
                Importar JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={importFile}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {saved.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nenhum range salvo ainda. Pinte o grid e clique em "Salvar range".
            </p>
          ) : (
            <ul className="space-y-2">
              {saved.map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-800/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-100">
                      <CustomBadge />
                      {record.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {record.players} jogadores · {record.position} ·{' '}
                      {scenarioLabel(record.scenario)} · {formatNumber(record.stack_bb)} bb ·{' '}
                      {formatNumber(record.range_pct)}% das mãos
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => onConsult(record)} className={secondaryButton}>
                      Consultar
                    </button>
                    <button type="button" onClick={() => load(record)} className={secondaryButton}>
                      Editar
                    </button>
                    {confirmingDelete === record.id ? (
                      <button
                        type="button"
                        onClick={() => remove(record)}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
                      >
                        Confirmar exclusão
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(record.id)}
                        className={secondaryButton}
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
