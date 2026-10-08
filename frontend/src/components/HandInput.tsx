import { type Ref, useState } from 'react'

import {
  type ParsedHand,
  RANKS,
  type Rank,
  SUIT_NAME,
  SUIT_SYMBOL,
  SUITS,
  type Suit,
} from '../lib/hands.ts'

interface HandInputProps {
  value: string
  parsed: ParsedHand
  onChange: (text: string) => void
  /** Chamado ao apertar Enter no campo (a aba de torneio usa para ir à próxima mão). */
  onSubmit?: () => void
  inputRef?: Ref<HTMLInputElement>
}

interface DraftCard {
  rank: Rank | null
  suit: Suit | null
}

type Draft = [DraftCard, DraftCard]

const EMPTY_CARD: DraftCard = { rank: null, suit: null }
const EMPTY_DRAFT: Draft = [EMPTY_CARD, EMPTY_CARD]

const SUIT_COLOR: Record<Suit, string> = {
  s: 'text-slate-200',
  h: 'text-red-400',
  d: 'text-sky-400',
  c: 'text-emerald-400',
}

/** O que o seletor visual mostra para um texto digitado; null = não mexer no seletor. */
function draftFromParsed(parsed: ParsedHand): Draft | null {
  if (parsed.status === 'empty') return EMPTY_DRAFT
  if (parsed.status !== 'valid') return null
  if (parsed.cards) return [parsed.cards[0], parsed.cards[1]]
  return [
    { rank: parsed.handClass[0] as Rank, suit: null },
    { rank: parsed.handClass[1] as Rank, suit: null },
  ]
}

/** Texto equivalente ao que já foi escolhido no seletor (pode ser uma mão incompleta). */
function draftToText([first, second]: Draft): string {
  if (!first.rank) return ''
  if (first.suit && second.rank && second.suit) {
    return `${first.rank}${first.suit}${second.rank}${second.suit}`
  }
  if (first.suit && second.rank) return `${first.rank}${first.suit}${second.rank}`
  if (second.rank) return `${first.rank}${second.rank}`
  return first.suit ? `${first.rank}${first.suit}` : first.rank
}

/** Em tela estreita o seletor começa fechado, para o resultado aparecer sem rolar muito. */
function startsWithPickerOpen(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 64rem)').matches
}

const pickButton =
  'rounded py-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-30'

/** Mão do herói: campo de texto validado ao digitar e seletor visual de duas cartas. */
export function HandInput({ value, parsed, onChange, onSubmit, inputRef }: HandInputProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFromParsed(parsed) ?? EMPTY_DRAFT)
  const [seenValue, setSeenValue] = useState(value)
  const [emitted, setEmitted] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(startsWithPickerOpen)

  // Quando o texto muda por fora (digitação, clique no grid), o seletor acompanha.
  if (value !== seenValue) {
    setSeenValue(value)
    if (value !== emitted) {
      const next = draftFromParsed(parsed)
      if (next) setDraft(next)
    }
  }

  function pick(index: 0 | 1, patch: Partial<DraftCard>) {
    const next: Draft = [draft[0], draft[1]]
    next[index] = { ...draft[index], ...patch }
    const text = draftToText(next)
    setDraft(next)
    setEmitted(text)
    onChange(text)
  }

  const message =
    parsed.status === 'incomplete' || parsed.status === 'invalid' ? parsed.message : null

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="hand-input"
          className="mb-1.5 block text-xs font-medium tracking-wide text-slate-400 uppercase"
        >
          Sua mão
        </label>
        <div className="flex gap-2">
          <input
            id="hand-input"
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && onSubmit) {
                event.preventDefault()
                onSubmit()
              }
            }}
            placeholder="K9o, AKs, 99 ou Kh9d"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={12}
            aria-invalid={parsed.status === 'invalid'}
            aria-describedby="hand-input-message"
            className={`w-full rounded-md border bg-slate-950 px-3 py-2 font-mono text-lg text-slate-100 placeholder:font-sans placeholder:text-sm placeholder:text-slate-600 focus:outline-none ${
              parsed.status === 'invalid'
                ? 'border-red-500 focus:border-red-400'
                : 'border-slate-700 focus:border-emerald-400'
            }`}
          />
          {value !== '' && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="rounded-md bg-slate-800 px-3 text-sm text-slate-300 hover:bg-slate-700"
            >
              Limpar
            </button>
          )}
        </div>
        <p
          id="hand-input-message"
          role={parsed.status === 'invalid' ? 'alert' : undefined}
          className={`mt-1 min-h-5 text-sm ${
            parsed.status === 'invalid' ? 'text-red-400' : 'text-amber-300'
          }`}
        >
          {message}
        </p>
      </div>

      <button
        type="button"
        aria-expanded={pickerOpen}
        aria-controls="card-picker"
        onClick={() => setPickerOpen((open) => !open)}
        className="flex w-full items-center justify-between rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
      >
        Escolher as cartas
        <span aria-hidden>{pickerOpen ? '▴' : '▾'}</span>
      </button>

      <div id="card-picker" hidden={!pickerOpen} className="space-y-2">
        {([0, 1] as const).map((index) => {
          const card = draft[index]
          const other = draft[index === 0 ? 1 : 0]
          return (
            <fieldset key={index} className="rounded-md border border-slate-800 p-2">
              <legend className="px-1 text-xs text-slate-400">
                Carta {index + 1}
                {card.rank && (
                  <span className={`ml-1 font-mono font-semibold ${card.suit ? SUIT_COLOR[card.suit] : 'text-slate-200'}`}>
                    {card.rank}
                    {card.suit ? SUIT_SYMBOL[card.suit] : ''}
                  </span>
                )}
              </legend>
              <div className="grid grid-cols-7 gap-1 sm:grid-cols-13">
                {RANKS.map((rank) => (
                  <button
                    key={rank}
                    type="button"
                    aria-label={`Carta ${index + 1}: ${rank}`}
                    aria-pressed={card.rank === rank}
                    onClick={() => pick(index, { rank })}
                    className={`${pickButton} ${
                      card.rank === rank
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    {rank}
                  </button>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-4 gap-1">
                {SUITS.map((suit) => (
                  <button
                    key={suit}
                    type="button"
                    aria-label={`Carta ${index + 1}: ${SUIT_NAME[suit]}`}
                    aria-pressed={card.suit === suit}
                    // A mesma carta não pode aparecer duas vezes.
                    disabled={card.rank !== null && other.rank === card.rank && other.suit === suit}
                    onClick={() => pick(index, { suit })}
                    className={`${pickButton} ${
                      card.suit === suit ? 'bg-slate-100' : 'bg-slate-800 hover:bg-slate-700'
                    } ${card.suit === suit && suit === 's' ? 'text-slate-900' : SUIT_COLOR[suit]}`}
                  >
                    {SUIT_SYMBOL[suit]}
                  </button>
                ))}
              </div>
            </fieldset>
          )
        })}
      </div>
    </div>
  )
}
