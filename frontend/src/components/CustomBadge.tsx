import type { RangeSource } from '../types.ts'

interface SourceBadgeProps {
  source: RangeSource
  /** Sobre fundo colorido (card da recomendação) o selo usa tons claros. */
  onColor?: boolean
}

const BADGE: Record<Exclude<RangeSource, 'solver'>, { label: string; className: string }> = {
  custom: {
    label: 'personalizado',
    className: 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/50',
  },
  reference: {
    label: 'referência',
    className: 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/50',
  },
}

/**
 * Selo de onde vem o range: 'personalizado' (salvo pelo usuário) ou 'referência'
 * (heurística de stack fundo). Os ranges calculados pelo solver não levam selo.
 */
export function SourceBadge({ source, onColor = false }: SourceBadgeProps) {
  if (source === 'solver') return null
  const badge = BADGE[source]
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] leading-none font-semibold tracking-wide uppercase ${
        onColor ? 'bg-white/20 text-white ring-1 ring-white/50' : badge.className
      }`}
    >
      {badge.label}
    </span>
  )
}

export function CustomBadge({ onColor = false }: { onColor?: boolean }) {
  return <SourceBadge source="custom" onColor={onColor} />
}
