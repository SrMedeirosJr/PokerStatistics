import {
  ACTION_COLOR,
  actionLabel,
  describeFrequencies,
  formatNumber,
  presentActions,
  recommendationHeadline,
  scenarioLabel,
} from '../lib/actions.ts'
import type { ParsedHand } from '../lib/hands.ts'
import type { LookupResponse, RangeResponse } from '../types.ts'
import { SourceBadge } from './CustomBadge.tsx'

interface ActionResultProps {
  hand: ParsedHand
  lookup: LookupResponse | null
  range: RangeResponse | null
  loading: boolean
  error: string | null
}

const MIXED_COLOR = '#b45309'

function tableName(spot: RangeResponse): string {
  const stack = `${formatNumber(spot.stack_used)} bb`
  if (spot.source === 'custom' && spot.name) return `${spot.name} · ${stack}`
  return stack
}

function StackNote({ spot, onColor = false }: { spot: RangeResponse; onColor?: boolean }) {
  const exact = spot.stack_requested === spot.stack_used
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      <SourceBadge source={spot.source} onColor={onColor} />
      <span>
        Tabela usada: <strong>{tableName(spot)}</strong>
        {!exact && ` (você informou ${formatNumber(spot.stack_requested)} bb; é a mais próxima)`}
      </span>
    </p>
  )
}

/** 'Raise para 3 bb' para cada ação da mão que tem tamanho sugerido. */
function sizeHints(lookup: LookupResponse): string[] {
  return presentActions(lookup.frequencies).flatMap(([action]) => {
    const size = lookup.sizes[action]
    return size === undefined
      ? []
      : [`${actionLabel(action, lookup.scenario)} para ${formatNumber(size)} bb`]
  })
}

/** Card grande com a ação recomendada para a mão, e o stack realmente usado. */
export function ActionResult({ hand, lookup, range, loading, error }: ActionResultProps) {
  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-red-500/60 bg-red-950/40 p-4">
        <p className="text-sm font-semibold text-red-300">Não foi possível consultar</p>
        <p className="mt-1 text-red-200">{error}</p>
      </div>
    )
  }

  if (!lookup) {
    const waiting = hand.status === 'valid' || (loading && !range)
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-slate-300">
        <p className="text-lg font-semibold text-slate-100">
          {waiting ? 'Consultando…' : 'Informe sua mão'}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          {waiting
            ? 'Buscando a recomendação para este spot.'
            : 'Digite a mão, escolha as cartas ou clique numa célula do grid para ver a ação recomendada.'}
        </p>
        {range && (
          <div className="mt-2 text-slate-400">
            <StackNote spot={range} />
          </div>
        )}
      </div>
    )
  }

  const color =
    lookup.recommendation === 'mixed' ? MIXED_COLOR : ACTION_COLOR[lookup.recommendation]
  const sizes = sizeHints(lookup)
  return (
    <div
      aria-live="polite"
      className={`rounded-xl p-4 text-white shadow-lg transition-opacity ${loading ? 'opacity-60' : ''}`}
      style={{ backgroundColor: color }}
    >
      <p className="text-sm font-medium text-white/80">
        {lookup.hand} · {lookup.players} jogadores · {lookup.position} ·{' '}
        {scenarioLabel(lookup.scenario)}
      </p>
      <p data-testid="recommendation" className="mt-1 text-4xl font-black tracking-tight sm:text-5xl">
        {recommendationHeadline(lookup.recommendation, lookup.frequencies, lookup.scenario)}
      </p>
      <p className="mt-1 text-base font-medium">
        {describeFrequencies(lookup.frequencies, lookup.scenario)}
      </p>
      {sizes.length > 0 && (
        <p data-testid="bet-size" className="text-sm font-medium text-white/90">
          Tamanho sugerido: {sizes.join(' · ')}
        </p>
      )}
      <div className="mt-2 text-white/85">
        <StackNote spot={lookup} onColor />
      </div>
    </div>
  )
}
