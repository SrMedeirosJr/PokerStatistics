import { describe, expect, it } from 'vitest'

import { comboCount, HAND_GRID, handClassAt, parseHand, TOTAL_COMBOS } from './hands.ts'

describe('grid de mãos', () => {
  it('tem 169 classes únicas na ordem padrão', () => {
    const hands = HAND_GRID.flat()

    expect(hands).toHaveLength(169)
    expect(new Set(hands).size).toBe(169)
    expect(hands[0]).toBe('AA')
    expect(hands[1]).toBe('AKs')
    expect(hands[13]).toBe('AKo')
    expect(hands[168]).toBe('22')
    expect(handClassAt(0, 12)).toBe('A2s')
    expect(handClassAt(12, 0)).toBe('A2o')
  })

  it('soma 1326 combos', () => {
    const total = HAND_GRID.flat().reduce((sum, hand) => sum + comboCount(hand), 0)

    expect(total).toBe(TOTAL_COMBOS)
    expect([comboCount('99'), comboCount('AKs'), comboCount('AKo')]).toEqual([6, 4, 12])
  })
})

describe('parseHand', () => {
  it.each([
    ['K9o', 'K9o'],
    ['k9o', 'K9o'],
    ['K9O', 'K9o'],
    ['9Ko', 'K9o'],
    ['aks', 'AKs'],
    ['Kh9d', 'K9o'],
    ['Kh9h', 'K9s'],
    ['9s9d', '99'],
    ['99', '99'],
    ['9dKh', 'K9o'],
    [' kh 9d ', 'K9o'],
    ['10h9h', 'T9s'],
    ['K♥9♦', 'K9o'],
  ])('normaliza %s para %s', (text, expected) => {
    const parsed = parseHand(text)

    expect(parsed).toMatchObject({ status: 'valid', handClass: expected })
  })

  it('guarda as cartas quando a mão vem com naipes', () => {
    expect(parseHand('Kh9d')).toMatchObject({
      cards: [
        { rank: 'K', suit: 'h' },
        { rank: '9', suit: 'd' },
      ],
    })
    expect(parseHand('K9o')).toMatchObject({ cards: null })
  })

  it('trata texto vazio como ausência de mão', () => {
    expect(parseHand('')).toEqual({ status: 'empty' })
    expect(parseHand('   ')).toEqual({ status: 'empty' })
  })

  it.each([
    ['K', 'Continue'],
    ['K9', 'use K9s ou K9o'],
    ['9K', 'use K9s ou K9o'],
    ['Kh', 'segunda carta'],
    ['Kh9', 'naipe da segunda carta'],
  ])('considera %s incompleta', (text, message) => {
    const parsed = parseHand(text)

    expect(parsed.status).toBe('incomplete')
    expect(parsed).toHaveProperty('message', expect.stringContaining(message))
  })

  it.each([
    ['X9o', 'Rank inválido'],
    ['KX', 'Rank inválido'],
    ['K9x', 'Sufixo inválido'],
    ['99s', 'Pares não têm sufixo'],
    ['Kh9z', 'Naipe inválido'],
    ['KhKh', 'Carta repetida'],
    ['AKQJ5', 'Mão inválida'],
  ])('rejeita %s', (text, message) => {
    const parsed = parseHand(text)

    expect(parsed.status).toBe('invalid')
    expect(parsed).toHaveProperty('message', expect.stringContaining(message))
  })
})
