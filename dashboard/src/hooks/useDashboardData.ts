import { useState, useEffect, useRef } from 'react'
import type { ModelAggregate, ModelInfo, NodeRow } from '@/types/api'

export function useDashboardData(sidecarUrl: string): {
  models: ModelAggregate[]
  nodes: NodeRow[]
  modelInfoMap: Record<string, ModelInfo>
  error: string | null
  countdown: number
  lastSuccess: Date | null
  isStale: boolean
} {
  const [models, setModels] = useState<ModelAggregate[]>([])
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [modelInfoMap, setModelInfoMap] = useState<Record<string, ModelInfo>>({})
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(30)
  const [lastSuccess, setLastSuccess] = useState<Date | null>(null)

  const isStale = !!lastSuccess && Date.now() - lastSuccess.getTime() > 60_000

  const abortRef = useRef<AbortController | null>(null)

  async function fetchAll(signal: AbortSignal) {
    const [modelsRes, nodesRes, modelInfoRes] = await Promise.all([
      fetch(`${sidecarUrl}/api/models`, { signal }),
      fetch(`${sidecarUrl}/api/nodes`, { signal }),
      fetch(`${sidecarUrl}/api/model-info`, { signal }),
    ])
    const [modelsData, nodesData, modelInfoData] = await Promise.all([
      modelsRes.json(),
      nodesRes.json(),
      modelInfoRes.json(),
    ])
    return { modelsData, nodesData, modelInfoData }
  }

  useEffect(() => {
    // Abort any in-flight fetch from strict-mode double-invoke
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    let mounted = true

    const doFetch = async () => {
      try {
        const { modelsData, nodesData, modelInfoData } = await fetchAll(controller.signal)
        if (!mounted) return
        setModels(Array.isArray(modelsData) ? modelsData : (modelsData.models ?? []))
        setNodes(Array.isArray(nodesData) ? nodesData : (nodesData.nodes ?? []))
        // /api/model-info returns Record<alias, ModelInfo> — use directly
        const infoMap: Record<string, ModelInfo> = (
          modelInfoData && typeof modelInfoData === 'object' && !Array.isArray(modelInfoData)
            ? modelInfoData as Record<string, ModelInfo>
            : {}
        )
        setModelInfoMap(infoMap)
        setError(null)
        setLastSuccess(new Date())
        setCountdown(30)
      } catch (err) {
        if (!mounted) return
        if ((err as Error).name === 'AbortError') return
        setError('Connection lost — retrying…')
        // Intentionally not resetting countdown (per spec H2)
      }
    }

    // Initial fetch
    doFetch()

    // Refetch every 30s
    const fetchInterval = setInterval(() => {
      doFetch()
    }, 30_000)

    // Countdown tick every 1s
    const tickInterval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1_000)

    return () => {
      mounted = false
      controller.abort()
      clearInterval(fetchInterval)
      clearInterval(tickInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidecarUrl])

  return { models, nodes, modelInfoMap, error, countdown, lastSuccess, isStale }
}
