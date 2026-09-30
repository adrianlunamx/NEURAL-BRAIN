import { useCallback, useEffect, useState } from 'react'
import { api } from '../utils/api'

/** Backend status + mutations (ingest / seed / reset). Calls `onChange` after each mutation. */
export function useBrain({ onChange, notify } = {}) {
  const [health, setHealth] = useState(null)
  const [busy, setBusy] = useState(null) // 'seed' | 'reset' | 'ingest' | null

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health())
    } catch {
      setHealth(null)
    }
  }, [])

  useEffect(() => {
    refreshHealth()
    const id = setInterval(refreshHealth, 15000)
    return () => clearInterval(id)
  }, [refreshHealth])

  const run = useCallback(
    async (kind, fn, success) => {
      setBusy(kind)
      try {
        const result = await fn()
        await onChange?.()
        await refreshHealth()
        if (success) notify?.({ type: 'success', message: success(result) })
        return result
      } catch (err) {
        notify?.({ type: 'error', message: err.message })
        throw err
      } finally {
        setBusy(null)
      }
    },
    [onChange, notify, refreshHealth],
  )

  const ingest = useCallback(
    (content, metadata) =>
      run('ingest', () => api.ingest(content, metadata), (r) =>
        r.created
          ? `Neurona ${r.node_id} creada · ${r.connections} sinapsis`
          : 'Ese conocimiento ya existía en el cerebro',
      ),
    [run],
  )

  const seed = useCallback(
    () => run('seed', api.seed, (r) => `${r.ingested} recuerdos implantados · ${r.stats.edges} sinapsis`),
    [run],
  )

  const reset = useCallback(() => run('reset', api.reset, () => 'Cerebro formateado'), [run])

  return { health, busy, ingest, seed, reset, refreshHealth }
}
