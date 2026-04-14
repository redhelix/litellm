import { useState, useEffect, useRef } from 'react'

export interface IntelligenceResult {
  generated_at: string | null
  model_used: string | null
  health_summary: string | null
  anomalies: Array<{ title: string; severity: 'low' | 'medium' | 'high'; description: string }>
  recommendations: Array<{ title: string; body: string }>
  hf_models: Array<{
    model_id: string
    hf_url: string
    tags: string[]
    likes: number
    downloads?: number
    last_modified: string
  }>
}

/**
 * Fetches the cached intelligence analysis from GET /api/intelligence.
 * Data refreshes only on remount — the backend runs on a 12h cycle.
 */
export function useIntelligence(sidecarUrl: string): {
  data: IntelligenceResult | null
  loading: boolean
  error: string | null
} {
  const [data, setData] = useState<IntelligenceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    let mounted = true

    setLoading(true)
    setError(null)

    fetch(`${sidecarUrl}/api/intelligence`, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: IntelligenceResult) => {
        if (mounted) {
          // Defensively coalesce missing array fields
          setData({
            ...d,
            anomalies: d.anomalies ?? [],
            recommendations: d.recommendations ?? [],
            hf_models: d.hf_models ?? [],
          })
          setError(null)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!mounted || (err as Error).name === 'AbortError') return
        setError(
          'Could not load health summary. Check that the sidecar is running on docker-001:4001.',
        )
        setLoading(false)
      })

    return () => {
      mounted = false
      controller.abort()
    }
  }, [sidecarUrl])

  return { data, loading, error }
}

export default useIntelligence
