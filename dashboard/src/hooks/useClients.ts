import { useState, useEffect, useRef } from 'react'
import type { ClientRow } from '@/types/api'

interface UseClientsParams {
  sidecarUrl?: string
  window?: string
}

export function useClients({ sidecarUrl = '', window = '24h' }: UseClientsParams = {}): {
  data: ClientRow[] | null
  loading: boolean
  error: string | null
} {
  const [data, setData] = useState<ClientRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    let mounted = true
    setLoading(true)

    fetch(`${sidecarUrl}/api/clients?window=${encodeURIComponent(window)}`, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: ClientRow[]) => {
        if (mounted) { setData(d); setError(null); setLoading(false) }
      })
      .catch(err => {
        if (!mounted || (err as Error).name === 'AbortError') return
        setError('Could not load client data')
        setLoading(false)
      })

    return () => { mounted = false; controller.abort() }
  }, [sidecarUrl, window])

  return { data, loading, error }
}
