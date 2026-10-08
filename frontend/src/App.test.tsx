import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import App from './App.tsx'
import { type FakeApi, installFakeApi } from './test/fakeApi.ts'

let api: FakeApi

beforeEach(() => {
  api = installFakeApi()
})

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('grid')
  return user
}

function choose(user: ReturnType<typeof userEvent.setup>, group: string, option: string) {
  const radios = within(screen.getByRole('radiogroup', { name: group }))
  return user.click(radios.getByRole('radio', { name: option }))
}

function selectedOption(group: string): string | null {
  const radios = within(screen.getByRole('radiogroup', { name: group }))
  return radios.getByRole('radio', { checked: true }).textContent
}

async function recommendation(text: string) {
  await waitFor(() => expect(screen.getByTestId('recommendation').textContent).toBe(text))
}

describe('App', () => {
  it('mostra a recomendação e destaca a mão no grid', async () => {
    const user = await renderApp()

    await choose(user, 'Jogadores na mesa', '8')
    await choose(user, 'Stack (big blinds)', '6')
    await choose(user, 'Sua posição', 'CO')
    await choose(user, 'Situação', 'Open')
    await user.type(screen.getByLabelText('Sua mão'), 'K9o')

    await recommendation('ALL-IN')
    expect(screen.getByRole('gridcell', { name: /^K9o:/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('gridcell', { selected: true })).toHaveLength(1)
    expect(screen.getAllByRole('gridcell')).toHaveLength(169)
    expect(api.calls).toContain('/api/lookup?players=8&position=CO&scenario=open&stack=6&hand=K9o')
    expect(screen.getByTestId('range-size').textContent).toBe(
      'Range de all-in: 2,1% · 28 / 1326 combos',
    )
  })

  it('mostra o range do spot antes de qualquer mão', async () => {
    await renderApp()

    await waitFor(() =>
      expect(api.calls).toContain('/api/ranges?players=8&position=CO&scenario=open&stack=10'),
    )
    expect(await screen.findByRole('gridcell', { name: 'AA: All-in 100%' })).toBeDefined()
    expect(screen.getByText('Informe sua mão')).toBeDefined()
    expect(screen.queryByTestId('recommendation')).toBeNull()
  })

  it('atualiza quando os seletores mudam', async () => {
    const user = await renderApp()
    await user.type(screen.getByLabelText('Sua mão'), 'K9o')
    await recommendation('ALL-IN')

    await choose(user, 'Sua posição', 'BB')

    expect(selectedOption('Situação')).toBe('vs SB')
    await recommendation('FOLD')
    expect(screen.getByRole('gridcell', { name: 'AA: Call 100%' })).toBeDefined()

    await choose(user, 'Situação', 'vs CO')
    await waitFor(() => expect(api.calls.at(-1)).toContain('position=BB&scenario=vs_CO'))
  })

  it('só oferece situações contra posições que agem antes', async () => {
    const user = await renderApp()

    await choose(user, 'Sua posição', 'LJ')

    const options = within(screen.getByRole('radiogroup', { name: 'Situação' })).getAllByRole('radio')
    expect(options.map((option) => option.textContent)).toEqual(['Open', 'vs UTG', 'vs UTG1'])
  })

  it('troca as posições disponíveis conforme o número de jogadores', async () => {
    const user = await renderApp()

    await choose(user, 'Jogadores na mesa', '6')

    const positions = within(screen.getByRole('radiogroup', { name: 'Sua posição' }))
    expect(positions.getAllByRole('radio').map((option) => option.textContent)).toEqual([
      'LJ',
      'HJ',
      'CO',
      'BTN',
      'SB',
      'BB',
    ])
  })

  it('mostra frequência mista', async () => {
    const user = await renderApp()
    await choose(user, 'Sua posição', 'BB')

    await user.type(screen.getByLabelText('Sua mão'), 'A9o')

    await recommendation('MISTO 40/60')
    expect(screen.getByText('Call 40% · Fold 60%')).toBeDefined()
  })

  it('seleciona a mão ao clicar numa célula do grid', async () => {
    const user = await renderApp()

    await user.click(await screen.findByRole('gridcell', { name: /^AKs:/ }))

    expect(screen.getByLabelText<HTMLInputElement>('Sua mão').value).toBe('AKs')
    await recommendation('ALL-IN')
  })

  it('valida a mão enquanto o usuário digita, sem consultar a API', async () => {
    const user = await renderApp()
    const input = screen.getByLabelText('Sua mão')

    await user.type(input, 'K9')
    expect(screen.getByText(/use K9s ou K9o/)).toBeDefined()

    await user.clear(input)
    await user.type(input, 'X9o')
    expect(screen.getByRole('alert').textContent).toContain('Rank inválido')
    expect(api.calls.some((call) => call.startsWith('/api/lookup'))).toBe(false)
  })

  it('monta a mão pelo seletor visual de cartas', async () => {
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Carta 1: K' }))
    await user.click(screen.getByRole('button', { name: 'Carta 1: copas' }))
    await user.click(screen.getByRole('button', { name: 'Carta 2: 9' }))
    await user.click(screen.getByRole('button', { name: 'Carta 2: ouros' }))

    expect(screen.getByLabelText<HTMLInputElement>('Sua mão').value).toBe('Kh9d')
    await recommendation('ALL-IN')
    expect(screen.getByRole('gridcell', { name: /^K9o:/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('não deixa escolher a mesma carta duas vezes', async () => {
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Carta 1: K' }))
    await user.click(screen.getByRole('button', { name: 'Carta 1: copas' }))
    await user.click(screen.getByRole('button', { name: 'Carta 2: K' }))

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Carta 2: copas' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Carta 2: ouros' }).disabled).toBe(false)
  })

  it('converte fichas em big blinds e mostra a tabela usada', async () => {
    const user = await renderApp()

    await user.click(screen.getByRole('checkbox', { name: 'Informar em fichas' }))
    expect(screen.getByText('Preencha as fichas e o valor do big blind.')).toBeDefined()
    await user.type(screen.getByRole('textbox', { name: 'Fichas' }), '4700')
    await user.type(screen.getByRole('textbox', { name: 'Big blind' }), '400')

    expect(screen.getByText('= 11,75 bb')).toBeDefined()
    await waitFor(() => expect(api.calls.at(-1)).toContain('chips=4700&big_blind=400'))
    expect(await screen.findByText(/você informou 11,75 bb/)).toBeDefined()
    expect(screen.getByText('12 bb')).toBeDefined()
  })

  it('mostra em português o erro devolvido pela API', async () => {
    const user = await renderApp()
    api.failNext('/api/lookup', 422, 'Cenário impossível: BTN não age antes de CO.')

    await user.type(screen.getByLabelText('Sua mão'), 'QQ')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Cenário impossível: BTN não age antes de CO.')
  })

  it('avisa quando a API está fora do ar e permite tentar de novo', async () => {
    api.setOffline(true)
    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não foi possível conectar à API')
    expect(screen.getByText('API offline')).toBeDefined()

    api.setOffline(false)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('grid')).toBeDefined()
    expect(await screen.findByText('API online')).toBeDefined()
  })
})
