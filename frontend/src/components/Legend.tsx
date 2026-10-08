import {
  ACTION_COLOR,
  ACTION_ORDER,
  actionLabel,
  activeAction,
  combosByAction,
  formatNumber,
} from '../lib/actions.ts'
import { TOTAL_COMBOS } from '../lib/hands.ts'
import type { ActionName, RangeResponse } from '../types.ts'
import { SourceBadge } from './CustomBadge.tsx'

interface LegendProps {
  range: RangeResponse | null
}

function Swatch({ background, label }: { background: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-3.5 rounded-sm" style={{ background }} aria-hidden />
      {label}
    </span>
  )
}

/** Ações que aparecem no range (fora o fold); num range do solver é só all-in ou call. */
function playedActions(range: RangeResponse | null): ActionName[] {
  if (!range) return ['allin']
  if (range.source === 'solver') return [activeAction(range.scenario)]
  const combos = combosByAction(range.range)
  const present = ACTION_ORDER.filter((action) => action !== 'fold' && combos[action] > 0)
  return present.length > 0 ? present : ['raise']
}

/** Legenda de cores do grid e tamanho do range (percentual e combos). */
export function Legend({ range }: LegendProps) {
  const actions = playedActions(range)
  const scenario = range?.scenario ?? 'open'
  const mixed = `linear-gradient(90deg, ${ACTION_COLOR[actions[0]]} 0% 50%, ${ACTION_COLOR.fold} 50% 100%)`
  const solver = !range || range.source === 'solver'

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-slate-300">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {actions.map((action) => (
          <Swatch
            key={action}
            background={ACTION_COLOR[action]}
            label={actionLabel(action, scenario)}
          />
        ))}
        <Swatch background={ACTION_COLOR.fold} label={actionLabel('fold')} />
        <Swatch background={mixed} label="Misto" />
      </div>
      {range && (
        <p data-testid="range-size" className="flex flex-wrap items-center gap-x-1.5">
          <SourceBadge source={range.source} />
          <span>
            {solver ? `Range de ${actionLabel(actions[0]).toLowerCase()}` : 'Mãos jogadas'}:{' '}
            <strong className="text-slate-100">{formatNumber(range.range_pct)}%</strong> ·{' '}
            {formatNumber(range.combos)} / {TOTAL_COMBOS} combos
          </span>
        </p>
      )}
    </div>
  )
}
