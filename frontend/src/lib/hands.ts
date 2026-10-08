/** As 169 classes de mãos na ordem do grid e a validação da mão digitada. */

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const
export const SUITS = ['s', 'h', 'd', 'c'] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]

export const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
export const SUIT_NAME: Record<Suit, string> = {
  s: 'espadas',
  h: 'copas',
  d: 'ouros',
  c: 'paus',
}

export const TOTAL_COMBOS = 1326

/** Classe da célula (linha, coluna): par na diagonal, suited acima, offsuit abaixo. */
export function handClassAt(row: number, col: number): string {
  if (row === col) return RANKS[row] + RANKS[col]
  if (row < col) return `${RANKS[row]}${RANKS[col]}s`
  return `${RANKS[col]}${RANKS[row]}o`
}

/** Grid 13x13, linha a linha. */
export const HAND_GRID: string[][] = RANKS.map((_, row) =>
  RANKS.map((_, col) => handClassAt(row, col)),
)

export function comboCount(handClass: string): number {
  if (handClass.length === 2) return 6
  return handClass.endsWith('s') ? 4 : 12
}

export interface Card {
  rank: Rank
  suit: Suit
}

export type ParsedHand =
  | { status: 'empty' }
  | { status: 'valid'; handClass: string; cards: [Card, Card] | null }
  /** Ainda pode virar uma mão válida se o usuário continuar digitando. */
  | { status: 'incomplete'; message: string }
  | { status: 'invalid'; message: string }

const SUIT_BY_SYMBOL: Record<string, Suit> = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' }
const EXAMPLES = 'K9o, AKs, 99 ou Kh9d'

function asRank(char: string): Rank | null {
  const upper = char.toUpperCase()
  return (RANKS as readonly string[]).includes(upper) ? (upper as Rank) : null
}

function asSuit(char: string): Suit | null {
  const lower = char.toLowerCase()
  return (SUITS as readonly string[]).includes(lower) ? (lower as Suit) : null
}

function rankIndex(rank: Rank): number {
  return RANKS.indexOf(rank)
}

function invalidRank(char: string): ParsedHand {
  return {
    status: 'invalid',
    message: `Rank inválido: '${char}'. Use A, K, Q, J, T, 9, 8, 7, 6, 5, 4, 3 ou 2.`,
  }
}

function invalidSuit(char: string): ParsedHand {
  return {
    status: 'invalid',
    message: `Naipe inválido: '${char}'. Use s (espadas), h (copas), d (ouros) ou c (paus).`,
  }
}

export function classOfCards(first: Card, second: Card): string {
  const [high, low] = rankIndex(first.rank) <= rankIndex(second.rank) ? [first, second] : [second, first]
  if (high.rank === low.rank) return high.rank + low.rank
  return `${high.rank}${low.rank}${high.suit === low.suit ? 's' : 'o'}`
}

/** Mesmas regras do backend (`app/core/cards.py`), para validar enquanto o usuário digita. */
export function parseHand(text: string): ParsedHand {
  let cleaned = text.replace(/\s+/g, '')
  for (const [symbol, suit] of Object.entries(SUIT_BY_SYMBOL)) {
    cleaned = cleaned.replaceAll(symbol, suit)
  }
  cleaned = cleaned.replaceAll('10', 'T')
  if (cleaned === '') return { status: 'empty' }
  if (cleaned.length > 4) {
    return { status: 'invalid', message: `Mão inválida. Exemplos válidos: ${EXAMPLES}.` }
  }

  const first = asRank(cleaned[0])
  if (!first) return invalidRank(cleaned[0])
  if (cleaned.length === 1) {
    return { status: 'incomplete', message: `Continue: ${EXAMPLES}.` }
  }

  const secondRank = asRank(cleaned[1])
  if (secondRank) {
    // Formato de classe: dois ranks e, se não for par, o sufixo s/o.
    const [high, low] =
      rankIndex(first) <= rankIndex(secondRank) ? [first, secondRank] : [secondRank, first]
    const suffix = cleaned.slice(2).toLowerCase()
    if (high === low) {
      if (suffix) return { status: 'invalid', message: `Pares não têm sufixo: use apenas ${high}${low}.` }
      return { status: 'valid', handClass: high + low, cards: null }
    }
    if (suffix === '') {
      return {
        status: 'incomplete',
        message: `Faltou dizer se ${high}${low} é suited ou offsuit: use ${high}${low}s ou ${high}${low}o.`,
      }
    }
    if (suffix !== 's' && suffix !== 'o') {
      return {
        status: 'invalid',
        message: `Sufixo inválido: '${cleaned.slice(2)}'. Use s (suited) ou o (offsuit).`,
      }
    }
    return { status: 'valid', handClass: `${high}${low}${suffix}`, cards: null }
  }

  // Formato de cartas: rank + naipe, duas vezes.
  const firstSuit = asSuit(cleaned[1])
  if (!firstSuit) return invalidRank(cleaned[1])
  if (cleaned.length === 2) {
    return { status: 'incomplete', message: 'Agora a segunda carta (ex.: Kh9d).' }
  }
  const second = asRank(cleaned[2])
  if (!second) return invalidRank(cleaned[2])
  if (cleaned.length === 3) {
    return { status: 'incomplete', message: 'Falta o naipe da segunda carta.' }
  }
  const secondSuit = asSuit(cleaned[3])
  if (!secondSuit) return invalidSuit(cleaned[3])
  if (first === second && firstSuit === secondSuit) {
    return {
      status: 'invalid',
      message: `Carta repetida: ${first}${firstSuit}${second}${secondSuit}. As duas cartas precisam ser diferentes.`,
    }
  }
  const cards: [Card, Card] = [
    { rank: first, suit: firstSuit },
    { rank: second, suit: secondSuit },
  ]
  return { status: 'valid', handClass: classOfCards(cards[0], cards[1]), cards }
}
