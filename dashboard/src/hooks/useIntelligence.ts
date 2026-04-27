import { useState, useEffect, useRef, useCallback } from 'react'

export interface IntelligenceResult {
  generated_at: string | null
  model_used: string | null
  health_summary: string | null
  anomalies: Array<{ title: string; severity: 'low' | 'medium' | 'high'; description: string }>
  recommendations: Array<{
    title: string
    body: string
    use_case?: string
    current_model?: string
    suggested_model?: string
    node?: string
  }>
  hf_models: Array<{
    model_id: string
    hf_url: string
    tags: string[]
    likes: number
    downloads?: number
    last_modified: string
  }>
  hf_search_rationale?: string
}

function fetchIntelligence(sidecarUrl: string, signal: AbortSignal): Promise<IntelligenceResult> {
  return fetch(`${sidecarUrl}/api/intelligence`, { signal })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
    .then((d: IntelligenceResult) => ({
      ...d,
      anomalies: d.anomalies ?? [],
      recommendations: d.recommendations ?? [],
      hf_models: d.hf_models ?? [],
    }))
}

/**
 * Fetches the cached intelligence analysis from GET /api/intelligence.
 * Exposes refresh() to trigger an on-demand run and poll for completion.
 */
export function useIntelligence(sidecarUrl: string): {
  data: IntelligenceResult | null
  loading: boolean
  error: string | null
  refreshing: boolean
  elapsedSeconds: number
  refresh: () => void
} {
  const [data, setData] = useState<IntelligenceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const loadData = useCallback((signal: AbortSignal) => {
    return fetchIntelligence(sidecarUrl, signal).then(d => {
      setData(d)
      setError(null)
    }).catch(err => {
      if ((err as Error).name === 'AbortError') return
      setError('Could not load health summary. Check that the sidecar is running on docker-001:4001.')
    })
  }, [sidecarUrl])

  // Initial load
  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    let mounted = true

    setLoading(true)
    loadData(controller.signal).finally(() => {
      if (mounted) setLoading(false)
    })

    return () => {
      mounted = false
      controller.abort()
    }
  }, [sidecarUrl, loadData])

  const refresh = useCallback(() => {
    if (refreshing) return
    setRefreshing(true)
    setElapsedSeconds(0)

    fetch(`${sidecarUrl}/api/intelligence/refresh`, { method: 'POST' })
      .catch(() => {/* fire and forget — polling will confirm */})

    // Elapsed timer — ticks every second
    timerRef.current = setInterval(() => {
      setElapsedSeconds(s => s + 1)
    }, 1000)

    // Poll status every 5s until job completes
    pollRef.current = setInterval(() => {
      fetch(`${sidecarUrl}/api/intelligence/status`)
        .then(r => r.json())
        .then((s: { running: boolean }) => {
          if (!s.running) {
            stopPolling()
            setRefreshing(false)
            setElapsedSeconds(0)
            // Reload fresh data
            const controller = new AbortController()
            abortRef.current?.abort()
            abortRef.current = controller
            loadData(controller.signal)
          }
        })
        .catch(() => {/* ignore transient errors during polling */})
    }, 5000)
  }, [sidecarUrl, refreshing, loadData])

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [])

  return { data, loading, error, refreshing, elapsedSeconds, refresh }
}

export default useIntelligence
