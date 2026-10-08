import { type PointerEvent, useRef } from 'react'

import { cellBackground, describeFrequencies } from '../lib/actions.ts'
import { HAND_GRID } from '../lib/hands.ts'
import type { RangeMap } from '../types.ts'

interface RangeGridProps {
  range: RangeMap | null
  selectedHand?: string | null
  /** Consulta: clicar numa célula seleciona a mão. */
  onSelect?: (hand: string) => void
  /** Editor: clicar ou arrastar pinta as células com a ação escolhida. */
  onPaint?: (hand: string) => void
  loading?: boolean
  label?: string
}

/** Grid 13x13 do range: cor pela ação, mão do herói destacada, clique seleciona ou pinta. */
export function RangeGrid({
  range,
  selectedHand = null,
  onSelect,
  onPaint,
  loading = false,
  label = 'Range completo do spot',
}: RangeGridProps) {
  const painting = useRef(false)
  const lastPainted = useRef<string | null>(null)

  function paintAt(event: PointerEvent) {
    // Com o dedo, o evento continua vindo da célula inicial; por isso a busca pelo ponto.
    const target = document.elementFromPoint?.(event.clientX, event.clientY)
    const hand = target?.closest<HTMLElement>('[data-hand]')?.dataset.hand
    if (hand && hand !== lastPainted.current) {
      lastPainted.current = hand
      onPaint?.(hand)
    }
  }

  function stopPainting() {
    painting.current = false
    lastPainted.current = null
  }

  const paintHandlers = onPaint
    ? {
        onPointerDown: (event: PointerEvent) => {
          painting.current = true
          paintAt(event)
        },
        onPointerMove: (event: PointerEvent) => {
          if (painting.current) paintAt(event)
        },
        onPointerUp: stopPainting,
        onPointerCancel: stopPainting,
        onPointerLeave: stopPainting,
      }
    : {}

  return (
    <div
      role="grid"
      aria-label={label}
      aria-busy={loading}
      {...paintHandlers}
      className={`grid grid-cols-13 gap-px overflow-hidden rounded-lg bg-slate-950 transition-opacity sm:gap-0.5 ${
        loading ? 'opacity-60' : ''
      } ${onPaint ? 'cursor-crosshair touch-none' : ''}`}
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
                // No editor o clique cobre o teclado; pintar duas vezes a mesma ação é inofensivo.
                onClick={() => (onPaint ? onPaint(hand) : onSelect?.(hand))}
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
