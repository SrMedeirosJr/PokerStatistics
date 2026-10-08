interface PositionHelperProps {
  /** Posições da mesa em ordem de ação preflop (que também é o sentido horário). */
  positions: string[]
  selected: string
  onSelect: (position: string) => void
}

interface Point {
  left: string
  top: string
}

/** Ponto na elipse da mesa; `turn` 0 fica embaixo e cresce no sentido horário. */
function onTable(turn: number, radiusX: number, radiusY: number): Point {
  const angle = Math.PI / 2 + turn * 2 * Math.PI
  return {
    left: `${50 + radiusX * Math.cos(angle)}%`,
    top: `${50 + radiusY * Math.sin(angle)}%`,
  }
}

/** Ajuda para descobrir a posição: texto curto e uma mini-mesa contada a partir do botão. */
export function PositionHelper({ positions, selected, onSelect }: PositionHelperProps) {
  const headsUp = !positions.includes('BTN')
  const dealer = positions.indexOf(headsUp ? 'SB' : 'BTN')
  const seats = positions.map((position, index) => ({
    position,
    seat: onTable((index - dealer) / positions.length, 43, 39),
  }))

  return (
    <details className="group rounded-md border border-slate-800 text-sm">
      <summary className="cursor-pointer px-3 py-2 text-slate-300 select-none hover:text-slate-100">
        Como descobrir minha posição?
      </summary>
      <div className="space-y-3 border-t border-slate-800 p-3">
        <ol className="list-decimal space-y-1 pl-5 text-slate-300">
          <li>
            Conte só quem recebeu cartas nesta mão. <strong>Cadeira vazia não conta</strong>: se a
            mesa é de 9 mas só 7 estão jogando, escolha 7 jogadores.
          </li>
          <li>
            Ache o botão do dealer (<strong>D</strong>).{' '}
            {headsUp
              ? 'No heads-up quem está no botão é o SB, e o outro jogador é o BB.'
              : 'Quem está nele é o BTN. Os dois seguintes, no sentido horário, são o SB e o BB.'}
          </li>
          {!headsUp && (
            <li>
              Volte a partir do botão, no sentido anti-horário: CO, HJ, LJ e, se sobrar gente, as
              posições UTG. Quem age logo depois do BB é o primeiro a falar.
            </li>
          )}
        </ol>

        <div className="relative mx-auto aspect-[16/10] w-full max-w-xs" aria-label="Mini-mesa">
          <div className="absolute inset-x-[16%] inset-y-[20%] rounded-[50%] border-2 border-emerald-800 bg-emerald-950/70" />
          <span
            className="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-900"
            style={onTable(0, 24, 19)}
            title="Botão do dealer"
          >
            D
          </span>
          {seats.map(({ position, seat }) => {
            const active = position === selected
            return (
              <button
                key={position}
                type="button"
                aria-label={`Assento ${position}`}
                aria-pressed={active}
                onClick={() => onSelect(position)}
                style={seat}
                className={`absolute min-w-9 -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-1 text-[11px] leading-none font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-emerald-400 ${
                  active
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
                }`}
              >
                {position}
              </button>
            )
          })}
        </div>

        <p className="text-xs text-slate-400">
          Ordem de ação antes do flop: {positions.join(' → ')}. Toque num assento para escolher a
          posição.
        </p>
      </div>
    </details>
  )
}
