import { cellBackground, describeFrequencies } from '../lib/actions.ts'
import { HAND_GRID } from '../lib/hands.ts'
import type { RangeMap } from '../types.ts'

interface RangeGridProps {
  range: RangeMap | null
  selectedHand: string | null
  onSelect: (hand: string) => void
  loading?: boolean
}

/** Grid 13x13 do range: cor pela ação, mão do herói destacada, clique seleciona a mão. */
export function RangeGrid({ range, selectedHand, onSelect, loading = false }: RangeGridProps) {
  return (
    <div
      role="grid"
      aria-label="Range completo do spot"
      aria-busy={loading}
      className={`grid grid-cols-13 gap-px overflow-hidden rounded-lg bg-slate-950 transition-opacity sm:gap-0.5 ${
        loading ? 'opacity-60' : ''
      }`}
    >
      {HAND_GRID.map((row, rowIndex) => (
        <div key={rowIndex} role="row" className="contents">
          {row.map((hand) => {
            const frequencies = range?.[hand]
            const selected = hand === selectedHand
            const folds = frequencies !== undefined && (frequencies.fold ?? 0) >= 1
            const summary = frequencies ? describeFrequencies(frequencies) : 'sem dados'
            return (
              <button
                key={hand}
                type="button"
                role="gridcell"
                aria-selected={selected}
                aria-label={`${hand}: ${summary}`}
                title={`${hand} — ${summary}`}
                data-hand={hand}
                onClick={() => onSelect(hand)}
                style={{ background: frequencies ? cellBackground(frequencies) : '#1e293b' }}
                // O contorno fica por dentro da célula para não ser cortado nas bordas do grid.
                className={`flex aspect-square items-center justify-center text-[9px] leading-none select-none sm:text-xs ${
                  selected
                    ? 'font-black text-white outline-2 -outline-offset-2 outline-amber-300 sm:outline-3 sm:-outline-offset-3'
                    : `font-semibold hover:brightness-125 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white ${
                        folds ? 'text-slate-400' : 'text-white'
                      }`
                }`}
              >
                {hand}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
