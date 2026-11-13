import { useEffect, useState } from 'react'

export function useNow(options?: { frozen?: number; tickMs?: number }): number {
  const frozen = options?.frozen
  const tickMs = options?.tickMs ?? 250
  const [now, setNow] = useState(() => frozen ?? Date.now())

  useEffect(() => {
    if (frozen !== undefined) return
    const id = window.setInterval(() => setNow(Date.now()), tickMs)
    return () => window.clearInterval(id)
  }, [frozen, tickMs])

  return frozen !== undefined ? frozen : now
}
