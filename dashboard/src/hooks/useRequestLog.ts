import { useState, useEffect, useRef } from 'react'
import type { RequestLogResponse } from '@/types/api'

interface UseRequestLogParams {
  window?: string
  limit?: number
  offset?: number
  model?: string | null
  sidecarUrl?: string
  sortBy?: 'startTime' | 'ttft_ms' | 'total_latency_ms'
  sortDir?: 'asc' | 'desc'
  statusFilter?: 'success' | 'repaired' | 'failed' | null
}

/**
 * Fetches paginated request log from the dashboard-sidecar /api/requests endpoint.
 *
 * @param params - Query parameters. sidecarUrl defaults to '' (relative).
 *   NOTE: if you construct the params object inline, memoize it with useMemo to
 *   avoid re-fetching on every render.
 */
export function useRequestLog(params: UseRequestLogParams = {}): {
  data: RequestLogResponse | null
  loading: boolean
  error: string | null
} {
  const { window = '30d', limit = 25, offset = 0, model = null, sidecarUrl = '', sortBy, sortDir, statusFilter } = params

  const [data, setData] = useState<RequestLogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    let mounted = true

    setLoading(true)

    const searchParams = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      window,
    })
    if (model) searchParams.set('model', model)
    if (sortBy) searchParams.set('sort_by', sortBy)
    if (sortDir) searchParams.set('sort_dir', sortDir)
    if (statusFilter) searchParams.set('status_filter', statusFilter)

    fetch(`${sidecarUrl}/api/requests?${searchParams}`, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: RequestLogResponse) => {
        if (mounted) {
          setData(d)
          setError(null)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!mounted || (err as Error).name === 'AbortError') return
        setError('Could not load request log — check that dashboard-sidecar is running on docker-001:4001.')
        setLoading(false)
      })

    return () => {
      mounted = false
      controller.abort()
    }
  }, [sidecarUrl, model, limit, offset, window, sortBy, sortDir, statusFilter])

  return { data, loading, error }
}

export default useRequestLog
