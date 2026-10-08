import { EQUITY_ITERATIONS, useEquity } from '../hooks/useEquity.ts'
import { formatNumber, formatPercent } from '../lib/actions.ts'
import { type ParsedHand, SUIT_SYMBOL } from '../lib/hands.ts'
import type { SpotQuery } from '../types.ts'

interface EquityPanelProps {
  query: SpotQuery | null
  hand: ParsedHand
  /** Muda quando os ranges personalizados mudam, para recalcular. */
  version?: number
}

const panel = 'rounded-xl border border-slate-800 bg-slate-900 p-4'

const OUTCOMES = [
  { key: 'win', label: 'Vitória', color: '#16a34a' },
  { key: 'tie', label: 'Empate', color: '#64748b' },
  { key: 'lose', label: 'Derrota', color: '#dc2626' },
] as const

/** Mão como o backend espera ('A9o' ou 'Ah9d') e como aparece na tela ('A♥9♦'). */
function heroHand(hand: ParsedHand): { request: string; display: string } | null {
  if (hand.status !== 'valid') return null
  if (!hand.cards) return { request: hand.handClass, display: hand.handClass }
  return {
    request: hand.cards.map((card) => card.rank + card.suit).join(''),
    display: hand.cards.map((card) => card.rank + SUIT_SYMBOL[card.suit]).join(''),
  }
}

/** Equity da mão contra o range de all-in de quem empurrou; só aparece em 'vs_{POS}'. */
export function EquityPanel({ query, hand, version = 0 }: EquityPanelProps) {
  const hero = heroHand(hand)
  const { pusher, pusherRange, equity, loading, error } = useEquity(
    query,
    hero?.request ?? null,
    version,
  )

  if (!pusher) return null
  const title = `Equity contra o all-in do ${pusher}`

  if (!hero) {
    return (
      <section className={panel} aria-label={title}>
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <p className="mt-1 text-sm text-slate-400">
          Informe sua mão para ver quanto ela ganha contra o range de all-in do {pusher}.
        </p>
      </section>
    )
  }

  return (
    <section className={panel} aria-label={title} aria-busy={loading}>
      <h2 className="text-sm font-semibold text-slate-200">{title}</h2>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          Não foi possível calcular a equity: {error}
        </p>
      )}

      {!error && (!equity || !pusherRange) && (
        <p className="mt-2 text-sm text-slate-400">Calculando a equity de {hero.display}…</p>
      )}

      {!error && equity && pusherRange && (
        <div className="mt-1">
          <p data-testid="equity" className="text-3xl font-black tracking-tight text-slate-50">
            {formatPercent(equity.equity)}
          </p>
          <p className="text-sm text-slate-400">
            {hero.display} contra o range de all-in do {pusher} (
            {formatNumber(pusherRange.range_pct)}% das mãos, tabela de{' '}
            {formatNumber(pusherRange.stack_used)} bb)
          </p>
          <div
            className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-800"
            role="img"
            aria-label={OUTCOMES.map(
              (outcome) => `${outcome.label} ${formatPercent(equity[outcome.key])}`,
            ).join(', ')}
          >
            {OUTCOMES.map((outcome) => (
              <span
                key={outcome.key}
                style={{ width: `${equity[outcome.key] * 100}%`, backgroundColor: outcome.color }}
              />
            ))}
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {OUTCOMES.map((outcome) => (
              <div key={outcome.key} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: outcome.color }}
                  aria-hidden
                />
                <dt className="text-slate-400">{outcome.label}</dt>
                <dd data-testid={`equity-${outcome.key}`} className="font-semibold text-slate-100">
                  {formatPercent(equity[outcome.key])}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-slate-500">
            Estimativa por Monte Carlo com {formatNumber(EQUITY_ITERATIONS)} simulações. A equity
            conta empate como meia vitória.
          </p>
        </div>
      )}
    </section>
  )
}
