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

async function openEditor(): Promise<User> {
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('tab', { name: 'Meus ranges' }))
  await screen.findByRole('grid', { name: 'Grid do range em edição' })
  return user
}

function cell(hand: string): HTMLElement {
  return screen.getByRole('gridcell', { name: new RegExp(`^${hand}:`) })
}

function brush(user: User, action: string) {
  const brushes = within(screen.getByRole('radiogroup', { name: 'Ação do pincel' }))
  return user.click(brushes.getByRole('radio', { name: action }))
}

async function saveRange(user: User, name: string, hands: string[]) {
  for (const hand of hands) await user.click(cell(hand))
  await user.type(screen.getByLabelText('Nome (opcional)'), name)
  await user.click(screen.getByRole('button', { name: 'Salvar range' }))
  await screen.findByText(`Range salvo: ${name}.`)
}

describe('editor de ranges', () => {
  it('cria um open de 40bb para o CO, salva e mostra na consulta', async () => {
    const user = await openEditor()

    await saveRange(user, 'Open CO 40bb', ['AA', 'KK', 'AKs'])

    expect(api.customRanges).toHaveLength(1)
    expect(api.customRanges[0]).toMatchObject({
      name: 'Open CO 40bb',
      players: 8,
      stack_bb: 40,
      position: 'CO',
      scenario: 'open',
    })
    expect(api.customRanges[0].actions.AA).toEqual({ raise: 1 })

    const saved = within(screen.getByRole('region', { name: 'Ranges salvos' }))
    expect(saved.getByText('Open CO 40bb')).toBeDefined()
    expect(saved.getByText('personalizado')).toBeDefined()
    await user.click(saved.getByRole('button', { name: 'Consultar' }))

    // De volta à consulta, já no spot do range, com o grid vindo de /api/lookup.
    const stacks = within(await screen.findByRole('radiogroup', { name: 'Stack (big blinds)' }))
    expect(stacks.getByRole('radio', { checked: true }).textContent).toBe('40')
    await user.type(screen.getByLabelText('Sua mão'), 'AKs')

    await waitFor(() => expect(screen.getByTestId('recommendation').textContent).toBe('RAISE'))
    expect(api.calls).toContain('/api/lookup?players=8&position=CO&scenario=open&stack=40&hand=AKs')
    expect(cell('AKs').getAttribute('aria-label')).toBe('AKs: Raise 100%')
    expect(cell('AKs').getAttribute('aria-selected')).toBe('true')
    expect(cell('72o').getAttribute('aria-label')).toBe('72o: Fold 100%')
    expect(screen.getByTestId('range-size').textContent).toBe(
      'personalizadoMãos jogadas: 1,2% · 16 / 1326 combos',
    )
    expect(screen.getByText('Open CO 40bb · 40 bb')).toBeDefined()
  })

  it('mostra o spot personalizado nos seletores com o selo', async () => {
    const user = await openEditor()
    await saveRange(user, 'Open CO 40bb', ['AA'])
    await user.click(screen.getByRole('tab', { name: 'Consultar' }))

    const stacks = within(await screen.findByRole('radiogroup', { name: 'Stack (big blinds)' }))
    expect(stacks.getByRole('radio', { name: '40 (tem range personalizado)' })).toBeDefined()
    const shortcut = await screen.findByRole('button', { name: /personalizado.*Open CO 40bb/ })
    expect(shortcut.getAttribute('aria-pressed')).toBe('false')

    await user.click(shortcut)

    expect(shortcut.getAttribute('aria-pressed')).toBe('true')
    expect(stacks.getByRole('radio', { checked: true }).textContent).toBe('40')
    await waitFor(() => expect(cell('AA').getAttribute('aria-label')).toBe('AA: Raise 100%'))
  })

  it('pinta com a ação do pincel e apaga com fold', async () => {
    const user = await openEditor()

    await user.click(cell('AA'))
    await brush(user, 'Call')
    await user.click(cell('KK'))
    await brush(user, 'All-in')
    await user.click(cell('QQ'))

    expect(cell('AA').getAttribute('aria-label')).toBe('AA: Raise 100%')
    expect(cell('KK').getAttribute('aria-label')).toBe('KK: Call 100%')
    expect(cell('QQ').getAttribute('aria-label')).toBe('QQ: All-in 100%')
    expect(screen.getByTestId('editor-summary').textContent).toBe(
      'All-in 0,5%Raise 0,5%Call 0,5%Fold 98,6%',
    )

    await brush(user, 'Fold')
    await user.click(cell('AA'))
    expect(cell('AA').getAttribute('aria-label')).toBe('AA: Fold 100%')

    await user.click(screen.getByRole('button', { name: 'Limpar grid' }))
    expect(screen.getByTestId('editor-summary').textContent).toContain('Fold 100%')
  })

  it('aplica um range colado, com pesos', async () => {
    const user = await openEditor()

    await user.type(screen.getByLabelText('Ou cole um range'), 'QQ+,AKs:0.5')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(await screen.findByText('4 mãos marcadas como Raise.')).toBeDefined()
    expect(cell('QQ').getAttribute('aria-label')).toBe('QQ: Raise 100%')
    expect(cell('AKs').getAttribute('aria-label')).toBe('AKs: Raise 50% · Fold 50%')
    expect(cell('JJ').getAttribute('aria-label')).toBe('JJ: Fold 100%')
  })

  it('mostra em português o erro de um range colado inválido', async () => {
    const user = await openEditor()

    await user.type(screen.getByLabelText('Ou cole um range'), 'XYZ')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect((await screen.findByRole('alert')).textContent).toBe("Trecho de range inválido: 'XYZ'.")
  })

  it('carrega um range salvo para edição e substitui o do mesmo spot', async () => {
    const user = await openEditor()
    await saveRange(user, 'Open CO 40bb', ['AA'])
    await user.click(screen.getByRole('button', { name: 'Limpar grid' }))

    await user.click(screen.getByRole('button', { name: 'Editar' }))
    expect(cell('AA').getAttribute('aria-label')).toBe('AA: Raise 100%')
    await user.click(cell('KK'))
    await user.click(screen.getByRole('button', { name: 'Salvar range' }))

    await waitFor(() => expect(api.customRanges[0].actions.KK).toEqual({ raise: 1 }))
    expect(api.customRanges).toHaveLength(1)
  })

  it('exclui um range só depois de confirmar', async () => {
    const user = await openEditor()
    await saveRange(user, 'Open CO 40bb', ['AA'])

    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(api.customRanges).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))

    expect(await screen.findByText('Range excluído: Open CO 40bb.')).toBeDefined()
    expect(api.customRanges).toHaveLength(0)
    expect(screen.getByText(/Nenhum range salvo ainda/)).toBeDefined()
  })

  it('valida o stack antes de salvar e mostra erros da API', async () => {
    const user = await openEditor()
    const stack = screen.getByLabelText('Stack (bb)')

    await user.clear(stack)
    await user.click(screen.getByRole('button', { name: 'Salvar range' }))
    expect(screen.getByRole('alert').textContent).toBe('Informe o stack em big blinds (ex.: 40).')
    expect(api.calls.filter((call) => call === '/api/custom-ranges')).toHaveLength(1)

    await user.type(stack, '40')
    api.failNext('/api/custom-ranges', 422, 'Stack inválido: use um valor entre 0 e 1000 bb.')
    await user.click(screen.getByRole('button', { name: 'Salvar range' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Stack inválido: use um valor entre 0 e 1000 bb.',
      ),
    )
    expect(api.customRanges).toHaveLength(0)
  })

  it('exporta e importa ranges em JSON', async () => {
    const user = await openEditor()
    const exportLink = screen.getByRole('link', { name: 'Exportar JSON' })
    expect(exportLink.getAttribute('href')).toBe('/api/custom-ranges/export')

    const document = {
      format: 'poker-range-helper/custom-ranges',
      version: 1,
      ranges: [
        {
          name: 'BB vs BTN 25bb',
          players: 8,
          stack_bb: 25,
          position: 'BB',
          scenario: 'vs_BTN',
          actions: { AA: { allin: 1 } },
        },
      ],
    }
    const file = new File([JSON.stringify(document)], 'ranges.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Importar JSON'), file)

    expect(await screen.findByText('Importação concluída: 1 novo(s), 0 atualizado(s).')).toBeDefined()
    expect(within(screen.getByRole('region', { name: 'Ranges salvos' })).getByText('BB vs BTN 25bb')).toBeDefined()

    const broken = new File(['{não é json'], 'quebrado.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Importar JSON'), broken)
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('O arquivo escolhido não é um JSON válido.'),
    )
  })

  it('ajusta posição e situação quando a mesa muda', async () => {
    const user = await openEditor()
    const group = (name: string) => within(screen.getByRole('radiogroup', { name }))

    await user.click(group('Posição').getByRole('radio', { name: 'BB' }))
    expect(group('Situação').getByRole('radio', { checked: true }).textContent).toBe('vs SB')

    await user.click(group('Jogadores na mesa').getByRole('radio', { name: '2' }))
    expect(group('Posição').getAllByRole('radio').map((item) => item.textContent)).toEqual(['SB', 'BB'])
  })
})
