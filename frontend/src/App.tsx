import { useEffect, useState } from 'react'

import { getHealth } from './lib/api.ts'

type ApiStatus = 'checking' | 'online' | 'offline'

const STATUS_LABEL: Record<ApiStatus, string> = {
  checking: 'Verificando API…',
  online: 'API online',
  offline: 'API offline',
}

const STATUS_DOT: Record<ApiStatus, string> = {
  checking: 'bg-amber-400',
  online: 'bg-emerald-400',
  offline: 'bg-red-500',
}

export default function App() {
  const [status, setStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal)
      .then((health) => setStatus(health.status === 'ok' ? 'online' : 'offline'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('offline')
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Poker Range Helper</h1>
        <span className="flex items-center gap-2 text-sm text-slate-300">
          <span className={`size-2.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
          {STATUS_LABEL[status]}
        </span>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <p className="text-slate-400">Push/fold para MTT — em construção.</p>
      </main>
    </div>
  )
}
