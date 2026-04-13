import { useState, useEffect, useRef } from 'react'
import type { TrendResponse } from '@/types/api'

interface UseTrendsParams {
  models: string[]
  window?: '7d' | '30d'
  sidecarUrl?: string
}

type TrendEntry = { data: TrendResponse | null; loading: boolean; error: string | null }

/**
 * Fetches trend series from the dashboard-sidecar /api/trends endpoint.
 * When a single model is passed, data/loading/error reflect that model's result.
 * For the multi-model use case, use the `results` map.
 *
 * NOTE: The models array is compared by value (JSON key), so it is safe to pass
 * an inline array — no useMemo required on the caller side.
 */
export function useTrends(params: UseTrendsParams): {
  data: TrendResponse | null
  loading: boolean
  error: string | null
  results: Record<string, TrendEntry>
} {
  const { models, window = '7d', sidecarUrl = '' } = params

  // Stable key so array identity changes do not cause infinite re-renders
  const modelsKey = models.join(',')

  const [results, setResults] = useState<Record<string, TrendEntry>>({})
  const abortRefs = useRef<AbortController[]>([])

  useEffect(() => {
    // Abort all in-flight fetches from previous render
    abortRefs.current.forEach(c => c.abort())
    abortRefs.current = []

    const modelList = modelsKey ? modelsKey.split(',') : []

    if (modelList.length === 0) {
      setResults({})
      return
    }

    // Initialise loading state for all models
    const init: Record<string, TrendEntry> = {}
    modelList.forEach(m => {
      init[m] = { data: null, loading: true, error: null }
    })
    setResults(init)

    let mounted = true

    const controllers = modelList.map(model => {
      const controller = new AbortController()
      abortRefs.current.push(controller)

      fetch(
        `${sidecarUrl}/api/trends?model=${encodeURIComponent(model)}&window=${window}`
      )
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((d: TrendResponse) => {
          if (mounted) {
            setResults(prev => ({
              ...prev,
              [model]: { data: d, loading: false, error: null },
            }))
          }
        })
        .catch(err => {
          if (!mounted || (err as Error).name === 'AbortError') return
          setResults(prev => ({
            ...prev,
            [model]: {
              data: null,
              loading: false,
              error: 'Could not load trend data — check that dashboard-sidecar is running on docker-001:4001.',
            },
          }))
        })

      return controller
    })

    return () => {
      mounted = false
      controllers.forEach(c => c.abort())
    }
  }, [sidecarUrl, modelsKey, window]) // eslint-disable-line react-hooks/exhaustive-deps

  // Convenience flattened view for the single-model case (used by tests and simple consumers)
  const firstModel = models[0]
  const firstResult = firstModel
    ? (results[firstModel] ?? { data: null, loading: true, error: null })
    : { data: null, loading: false, error: null }

  return {
    data: firstResult.data,
    loading: firstResult.loading,
    error: firstResult.error,
    results,
  }
}

export default useTrends
