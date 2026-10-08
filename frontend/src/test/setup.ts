import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// O padrão de 1 s é pouco para os fluxos com debounce quando a máquina está carregada.
configure({ asyncUtilTimeout: 5000 })

afterEach(cleanup)
