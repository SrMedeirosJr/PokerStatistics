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

  it('calcula a equity contra o range de all-in de quem empurrou', async () => {
    const user = await renderApp()
    await choose(user, 'Sua posição', 'BB')
    await choose(user, 'Stack (big blinds)', '6')
    await choose(user, 'Situação', 'vs CO')

    await user.type(screen.getByLabelText('Sua mão'), 'A9o')

    const panel = within(await screen.findByRole('region', { name: 'Equity contra o all-in do CO' }))
    await waitFor(() => expect(panel.getByTestId('equity').textContent).toBe('48%'))
    expect(panel.getByTestId('equity-win').textContent).toBe('47%')
    expect(panel.getByTestId('equity-tie').textContent).toBe('2%')
    expect(panel.getByTestId('equity-lose').textContent).toBe('51%')
    expect(panel.getByText(/A9o contra o range de all-in do CO/)).toBeDefined()

    // O range usado é o de 'open' do CO, no mesmo stack e na mesma mesa.
    expect(api.calls).toContain('/api/ranges?players=8&position=CO&scenario=open&stack=6')
    expect(api.equityRequests.at(-1)).toMatchObject({
      hero: 'A9o',
      villain_range: 'AA,AKs,KK,K9o',
      iterations: 20000,
    })
  })

  it('manda as cartas exatas para a equity quando a mão tem naipes', async () => {
    const user = await renderApp()
    await choose(user, 'Sua posição', 'BB')

    await user.type(screen.getByLabelText('Sua mão'), 'Ah9d')

    const panel = within(await screen.findByRole('region', { name: 'Equity contra o all-in do SB' }))
    expect(await panel.findByText(/A♥9♦ contra o range de all-in do SB/)).toBeDefined()
    expect(api.equityRequests.at(-1)).toMatchObject({ hero: 'Ah9d' })
  })

  it('só mostra o painel de equity contra um all-in', async () => {
    const user = await renderApp()
    await user.type(screen.getByLabelText('Sua mão'), 'K9o')
    await recommendation('ALL-IN')
    expect(screen.queryByRole('region', { name: /Equity contra/ })).toBeNull()

    await user.clear(screen.getByLabelText('Sua mão'))
    await choose(user, 'Sua posição', 'BB')

    const panel = within(screen.getByRole('region', { name: 'Equity contra o all-in do SB' }))
    expect(panel.getByText(/Informe sua mão para ver quanto ela ganha/)).toBeDefined()
    expect(api.equityRequests).toHaveLength(0)
  })

  it('mostra em português o erro do cálculo de equity', async () => {
    const user = await renderApp()
    await choose(user, 'Sua posição', 'BB')
    api.failNext('/api/equity', 422, 'O range do adversário não tem nenhum combo compatível.')

    await user.type(screen.getByLabelText('Sua mão'), 'A9o')

    const panel = within(await screen.findByRole('region', { name: 'Equity contra o all-in do SB' }))
    const alert = await panel.findByRole('alert')
    expect(alert.textContent).toBe(
      'Não foi possível calcular a equity: O range do adversário não tem nenhum combo compatível.',
    )
    // O erro da equity não derruba a recomendação.
    await recommendation('MISTO 40/60')
  })

  it('explica as posições e deixa escolher pelo assento na mini-mesa', async () => {
    const user = await renderApp()

    await user.click(screen.getByText('Como descobrir minha posição?'))
    expect(screen.getByText(/Cadeira vazia não conta/)).toBeDefined()
    expect(screen.getByText(/UTG → UTG1 → LJ → HJ → CO → BTN → SB → BB/)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Assento BTN' }))

    expect(selectedOption('Sua posição')).toBe('BTN')
    expect(screen.getByRole('button', { name: 'Assento BTN' }).getAttribute('aria-pressed')).toBe('true')

    await choose(user, 'Jogadores na mesa', '2')
    expect(screen.getByText(/No heads-up quem está no botão é o SB/)).toBeDefined()
    expect(screen.getAllByRole('button', { name: /^Assento / })).toHaveLength(2)
  })

  it('com stack fundo mostra raise, tamanho e o selo de referência', async () => {
    const user = await renderApp()
    await choose(user, 'Stack (big blinds)', '60 (tabela de referência)')
    await choose(user, 'Sua posição', 'SB')

    await user.type(screen.getByLabelText('Sua mão'), 'KTo')

    await recommendation('RAISE')
    expect(screen.getByTestId('bet-size').textContent).toBe('Tamanho sugerido: Raise para 3 bb')
    expect(screen.getByTestId('range-size').textContent).toBe(
      'referênciaMãos jogadas: 2,1% · 28 / 1326 combos',
    )
    expect(screen.getByTestId('table-notes').textContent).toContain('não por solver')
    expect(screen.getByRole('gridcell', { name: 'KTo: Raise 100%' })).toBeDefined()
    expect(api.calls).toContain('/api/lookup?players=8&position=SB&scenario=open&stack=60&hand=KTo')
  })

  it('contra um raise com stack fundo fala em 3-bet e call', async () => {
    const user = await renderApp()
    await choose(user, 'Stack (big blinds)', '60 (tabela de referência)')
    await choose(user, 'Sua posição', 'BB')
    await choose(user, 'Situação', 'vs CO')

    await user.type(screen.getByLabelText('Sua mão'), 'AA')

    await recommendation('3-BET')
    expect(screen.getByTestId('bet-size').textContent).toBe('Tamanho sugerido: 3-bet para 6,6 bb')
    expect(screen.getByRole('gridcell', { name: 'QQ: Call 100%' })).toBeDefined()
    expect(screen.getByText(/essa posição abriu com raise/)).toBeDefined()

    // A equity passa a ser contra o range de abertura (raise) do CO.
    const panel = within(await screen.findByRole('region', { name: 'Equity contra o raise do CO' }))
    expect(await panel.findByText(/AA contra o range de abertura do CO/)).toBeDefined()
    expect(api.equityRequests.at(-1)).toMatchObject({ hero: 'AA', villain_range: 'AA,AKs,KK,KTo' })
  })

  it('avisa quando não há tabela para o stack informado', async () => {
    const user = await renderApp()

    await user.click(screen.getByRole('checkbox', { name: 'Informar em fichas' }))
    await user.type(screen.getByRole('textbox', { name: 'Fichas' }), '250000')
    await user.type(screen.getByRole('textbox', { name: 'Big blind' }), '1000')

    const notes = await screen.findByTestId('table-notes')
    expect(notes.textContent).toContain('Não há tabela para 250 bb: a mais próxima é a de 100 bb.')
  })

  it('não mostra avisos nas tabelas de push/fold dentro da faixa', async () => {
    await renderApp()

    await screen.findByRole('gridcell', { name: 'AA: All-in 100%' })
    expect(screen.queryByTestId('table-notes')).toBeNull()
    expect(screen.queryByTestId('bet-size')).toBeNull()
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
