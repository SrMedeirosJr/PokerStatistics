import { ACTION_COLOR, ACTION_LABEL, activeAction, formatNumber } from '../lib/actions.ts'
import { TOTAL_COMBOS } from '../lib/hands.ts'
import type { ActionName, RangeResponse } from '../types.ts'

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

/** Legenda de cores do grid e tamanho do range (percentual e combos). */
export function Legend({ range }: LegendProps) {
  const active: ActionName = range ? activeAction(range.scenario) : 'allin'
  const mixed = `linear-gradient(90deg, ${ACTION_COLOR[active]} 0% 50%, ${ACTION_COLOR.fold} 50% 100%)`

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-slate-300">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Swatch background={ACTION_COLOR[active]} label={ACTION_LABEL[active]} />
        <Swatch background={ACTION_COLOR.fold} label={ACTION_LABEL.fold} />
        <Swatch background={mixed} label="Misto" />
      </div>
      {range && (
        <p data-testid="range-size">
          Range de {ACTION_LABEL[active].toLowerCase()}:{' '}
          <strong className="text-slate-100">{formatNumber(range.range_pct)}%</strong> ·{' '}
          {formatNumber(range.combos)} / {TOTAL_COMBOS} combos
        </p>
      )}
    </div>
  )
}
