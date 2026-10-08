interface Option<T> {
  value: T
  label: string
  /** Marca a opção com um ponto e explica o motivo no tooltip (ex.: range personalizado). */
  mark?: string
}

interface ChoiceGroupProps<T> {
  label: string
  options: Option<T>[]
  value: T | null
  onChange: (value: T) => void
  disabled?: boolean
}

/** Grupo de botões de escolha única (jogadores, stack, posição, situação). */
export function ChoiceGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-50">
      <legend className="mb-1.5 text-xs font-medium tracking-wide text-slate-400 uppercase">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.mark ? `${option.label} (${option.mark})` : undefined}
              title={option.mark}
              onClick={() => onChange(option.value)}
              className={`relative min-w-10 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
                selected
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {option.label}
              {option.mark && (
                <span
                  className="absolute -top-1 -right-1 size-2.5 rounded-full bg-violet-400 ring-2 ring-slate-900"
                  aria-hidden
                />
              )}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
