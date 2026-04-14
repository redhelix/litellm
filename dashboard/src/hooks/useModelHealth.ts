import { useState, useEffect, useRef } from 'react'
import type { ModelHealth } from '@/types/api'

interface UseModelHealthParams {
  sidecarUrl?: string
  intervalMs?: number
}

export function useModelHealth({ sidecarUrl = '', intervalMs = 30_000 }: UseModelHealthParams = {}): {
  health: ModelHealth
  loading: boolean
  error: string | null
} {
  const [health, setHealth] = useState<ModelHealth>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    async function fetchHealth() {
      try {
        const r = await fetch(`${sidecarUrl}/api/model-health`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d: ModelHealth = await r.json()
        if (mountedRef.current) {
          setHealth(d)
          setError(null)
          setLoading(false)
        }
      } catch {
        if (mountedRef.current) {
          setError('Could not load model health')
          setLoading(false)
        }
      }
    }

    fetchHealth()
    const id = setInterval(fetchHealth, intervalMs)
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [sidecarUrl, intervalMs])

  return { health, loading, error }
}
