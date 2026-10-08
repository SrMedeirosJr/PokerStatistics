interface CustomBadgeProps {
  /** Sobre fundo colorido (card da recomendação) o selo usa tons claros. */
  onColor?: boolean
}

/** Selo que marca ranges criados pelo usuário, em oposição aos gerados pelo solver. */
export function CustomBadge({ onColor = false }: CustomBadgeProps) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] leading-none font-semibold tracking-wide uppercase ${
        onColor
          ? 'bg-white/20 text-white ring-1 ring-white/50'
          : 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/50'
      }`}
    >
      personalizado
    </span>
  )
}
