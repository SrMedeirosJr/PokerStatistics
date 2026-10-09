import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import App from './App.tsx'
import { type FakeApi, installFakeApi } from './test/fakeApi.ts'

type User = ReturnType<typeof userEvent.setup>

let api: FakeApi

beforeEach(() => {
  api = installFakeApi()
})

async function openTournament(): Promise<User> {
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('tab', { name: 'Torneio' }))
  await screen.findByRole('region', { name: 'Torneio' })
  return user
}

function group(name: string) {
  return within(screen.getByRole('radiogroup', { name }))
}

function position(): string | null {
  return group('Sua posição nesta mão').getByRole('radio', { checked: true }).textContent
}

/** A mesa do print: blinds 500/1.000 com ante 100 e 58.416 fichas. */
async function fillBlinds(user: User) {
  await user.type(screen.getByRole('textbox', { name: 'Minhas fichas' }), '58416')
  await user.type(screen.getByRole('textbox', { name: 'Small blind' }), '500')
  await user.type(screen.getByRole('textbox', { name: 'Big blind' }), '1000')
  await user.type(screen.getByRole('textbox', { name: 'Ante' }), '100')
}

async function recommendation(text: string) {
  await waitFor(() => expect(screen.getByTestId('recommendation').textContent).toBe(text))
}

describe('aba de torneio', () => {
  it('converte fichas em bb e mostra a jogada para o stack fundo', async () => {
    const user = await openTournament()
    expect(screen.getByTestId('tournament-stack').textContent).toContain('Informe suas fichas')

    await fillBlinds(user)
    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'SB' }))
    await user.type(screen.getByLabelText('Sua mão'), 'KTo')

    expect(screen.getByTestId('tournament-stack').textContent).toBe('Seu stack: 58,42 bb')
    await recommendation('RAISE')
    expect(screen.getByTestId('bet-size').textContent).toBe('Tamanho sugerido: Raise para 3 bb')
    expect(api.calls).toContain(
      '/api/lookup?players=8&position=SB&scenario=open&chips=58416&big_blind=1000&hand=KTo',
    )
  })

  it('mostra quantas mãos faltam para os blinds e o custo da volta', async () => {
    const user = await openTournament()
    await fillBlinds(user)
    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'SB' }))

    expect(screen.getByTestId('until-sb').textContent).toBe('nesta mão')
    expect(screen.getByTestId('until-bb').textContent).toBe('em 7 mãos')
    expect(screen.getByTestId('orbit-cost').textContent).toBe('2.300 fichas')
    expect(screen.getByTestId('orbits').textContent).toBe('25,4 voltas')

    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'UTG' }))
    expect(screen.getByTestId('until-bb').textContent).toBe('na próxima mão')
    expect(screen.getByTestId('until-sb').textContent).toBe('em 2 mãos')
  })

  it('roda a posição a cada mão e guarda o histórico', async () => {
    const user = await openTournament()
    await fillBlinds(user)
    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'SB' }))
    await user.type(screen.getByLabelText('Sua mão'), 'KTo')
    await recommendation('RAISE')

    await user.click(screen.getByRole('button', { name: 'Próxima mão' }))

    // Depois do SB o botão chega em você: a próxima posição é o BTN.
    expect(position()).toBe('BTN')
    expect(screen.getByTestId('hand-number').textContent).toBe('Mão 2')
    const input = screen.getByLabelText<HTMLInputElement>('Sua mão')
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    expect(screen.getByTestId('until-bb').textContent).toBe('em 6 mãos')
    const history = within(screen.getByRole('region', { name: 'Mãos da sessão' }))
    expect(history.getByRole('listitem').textContent).toBe('Mão 1SBKToRAISE58,42 bb')
  })

  it('Enter passa para a próxima mão e a rotação dá a volta na mesa', async () => {
    const user = await openTournament()
    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'BTN' }))
    const input = screen.getByLabelText('Sua mão')
    const seen = [position()]

    for (let hand = 0; hand < 8; hand += 1) {
      await user.type(input, '{Enter}')
      seen.push(position())
    }

    expect(seen).toEqual(['BTN', 'CO', 'HJ', 'LJ', 'UTG1', 'UTG', 'BB', 'SB', 'BTN'])
    expect(screen.getByTestId('hand-number').textContent).toBe('Mão 9')
  })

  it('no BB a situação já vem contra o SB', async () => {
    const user = await openTournament()
    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'UTG' }))

    await user.click(screen.getByRole('button', { name: 'Próxima mão' }))

    expect(position()).toBe('BB')
    expect(group('Situação').getByRole('radio', { checked: true }).textContent).toBe('vs SB')
  })

  it('volta uma mão quando o avanço foi sem querer', async () => {
    const user = await openTournament()
    await fillBlinds(user)
    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'SB' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Voltar' }).disabled).toBe(true)
    await user.type(screen.getByLabelText('Sua mão'), 'KTo')
    await recommendation('RAISE')
    await user.click(screen.getByRole('button', { name: 'Próxima mão' }))

    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(position()).toBe('SB')
    expect(screen.getByTestId('hand-number').textContent).toBe('Mão 1')
    expect(screen.getByText(/As mãos que você digitar aparecem aqui/)).toBeDefined()
  })

  it('usa a tabela de push/fold quando o stack está curto', async () => {
    const user = await openTournament()
    await user.type(screen.getByRole('textbox', { name: 'Minhas fichas' }), '8000')
    await user.type(screen.getByRole('textbox', { name: 'Big blind' }), '1000')
    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'CO' }))

    await user.type(screen.getByLabelText('Sua mão'), 'K9o')

    await recommendation('ALL-IN')
    expect(screen.queryByTestId('bet-size')).toBeNull()
    // Sem o small blind não dá para calcular o custo da volta.
    expect(screen.queryByTestId('orbit-cost')).toBeNull()
  })

  it('lembra a sessão ao reabrir e zera só depois de confirmar', async () => {
    const user = await openTournament()
    await fillBlinds(user)
    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'SB' }))
    await user.type(screen.getByLabelText('Sua mão'), 'KTo')
    await recommendation('RAISE')
    await user.click(screen.getByRole('button', { name: 'Próxima mão' }))

    // Sair da aba e voltar recria o componente a partir do que ficou salvo.
    await user.click(screen.getByRole('tab', { name: 'Consultar' }))
    await user.click(screen.getByRole('tab', { name: 'Torneio' }))

    expect(position()).toBe('BTN')
    expect(screen.getByTestId('hand-number').textContent).toBe('Mão 2')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Minhas fichas' }).value).toBe('58416')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Nova sessão' }))
    expect(screen.getByTestId('hand-number').textContent).toBe('Mão 2')
    await user.click(screen.getByRole('button', { name: 'Confirmar: zerar sessão' }))

    expect(screen.getByTestId('hand-number').textContent).toBe('Mão 1')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Minhas fichas' }).value).toBe('')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('ajusta as posições quando o número de jogadores muda', async () => {
    const user = await openTournament()
    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'UTG' }))

    await user.click(group('Jogadores na mesa').getByRole('radio', { name: '6' }))

    const positions = group('Sua posição nesta mão').getAllByRole('radio')
    expect(positions.map((item) => item.textContent)).toEqual(['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'])
    expect(position()).toBe('BTN')
  })
})

describe('dica de call e 3-bet', () => {
  it('lembra de escolher "vs" quando alguém pode ter entrado antes', async () => {
    const user = await openTournament()

    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'CO' }))
    expect(screen.getByTestId('facing-hint').textContent).toContain('Escolha "vs"')

    // Depois de escolher o "vs" a dica some: as opções já são call e 3-bet.
    await user.click(group('Situação').getByRole('radio', { name: 'vs UTG' }))
    expect(screen.queryByTestId('facing-hint')).toBeNull()
  })

  it('não mostra a dica no UTG, onde ninguém age antes', async () => {
    const user = await openTournament()

    await user.click(group('Sua posição nesta mão').getByRole('radio', { name: 'UTG' }))

    expect(screen.queryByTestId('facing-hint')).toBeNull()
    expect(group('Situação').getAllByRole('radio')).toHaveLength(1)
  })
})
