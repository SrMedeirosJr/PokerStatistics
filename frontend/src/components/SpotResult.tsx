import type { SpotData } from '../hooks/useSpotData.ts'
import { formatNumber } from '../lib/actions.ts'
import type { ParsedHand } from '../lib/hands.ts'
import type { RangeResponse, SpotQuery } from '../types.ts'
import { ActionResult } from './ActionResult.tsx'
import { EquityPanel } from './EquityPanel.tsx'
import { Legend } from './Legend.tsx'
import { RangeGrid } from './RangeGrid.tsx'

interface SpotResultProps {
  query: SpotQuery | null
  hand: ParsedHand
  data: SpotData
  /** Muda quando os ranges personalizados mudam, para recalcular a equity. */
  version: number
  onSelectHand: (hand: string) => void
}

/** Abaixo disso o modelo "só o primeiro call" satura (ver Decisões no PLANO.md). */
const SATURATED_BELOW_BB = 5

const panel = 'rounded-xl border border-slate-800 bg-slate-900 p-4'
const note = 'rounded-md border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-200'

/** Avisos sobre os limites da tabela que está sendo mostrada. */
function TableNotes({ spot }: { spot: RangeResponse }) {
  const notes: string[] = []
  if (spot.stack_requested > spot.stack_used * 1.25) {
    notes.push(
      `Não há tabela para ${formatNumber(spot.stack_requested)} bb: a mais próxima é a de ${formatNumber(spot.stack_used)} bb.`,
    )
  }
  if (spot.source === 'solver' && spot.stack_used < SATURATED_BELOW_BB) {
    notes.push(
      `Com menos de ${SATURATED_BELOW_BB} bb a simplificação do modelo (só o primeiro call conta) pesa mais e os ranges saem bem largos. Use com cautela.`,
    )
  }
  if (spot.source === 'reference') {
    notes.push(
      'Tabela de referência: montada por heurística (força da mão e jogabilidade), não por solver. ' +
        'Não cobre limp nem a resposta a um 3-bet. Use como ponto de partida e ajuste em "Meus ranges".',
    )
  }
  if (notes.length === 0) return null
  return (
    <div className={`${note} space-y-1.5`} data-testid="table-notes">
      {notes.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </div>
  )
}

/** Recomendação, avisos, equity e grid do spot; usado na consulta e na aba de torneio. */
export function SpotResult({ query, hand, data, version, onSelectHand }: SpotResultProps) {
  const { range, lookup, loading, error } = data
  const shown = error ? null : range
  return (
    <div className="space-y-4">
      <ActionResult hand={hand} lookup={lookup} range={range} loading={loading} error={error} />
      {shown && <TableNotes spot={shown} />}
      <EquityPanel query={query} hand={hand} version={version} source={shown?.source} />
      <section className={`${panel} space-y-3`} aria-label="Range">
        <RangeGrid
          range={shown?.range ?? null}
          selectedHand={hand.status === 'valid' ? hand.handClass : null}
          onSelect={onSelectHand}
          loading={loading}
          scenario={shown?.scenario}
        />
        <Legend range={shown} />
      </section>
    </div>
  )
}
