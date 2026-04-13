import type { ModelAggregate } from '@/types/api'

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

export interface OverviewAggregate {
  ttft_p50: number | null
  ttft_p95: number | null
  total_latency_p50: number | null
  total_latency_p95: number | null
  tokens_per_sec: number
  avg_context_utilization: number | null
}

export function computeOverview(models: ModelAggregate[]): OverviewAggregate {
  const pluck = (key: keyof ModelAggregate): number[] =>
    models
      .map((m) => m[key] as number | null)
      .filter((v): v is number => v !== null)

  const ctxValues = pluck('avg_context_utilization')
  const avgCtx = ctxValues.length > 0
    ? ctxValues.reduce((a, b) => a + b, 0) / ctxValues.length
    : null

  const tpsValues = pluck('tokens_per_sec')
  const totalTps = tpsValues.reduce((a, b) => a + b, 0)

  return {
    ttft_p50: median(pluck('ttft_p50')),
    ttft_p95: median(pluck('ttft_p95')),
    total_latency_p50: median(pluck('total_latency_p50')),
    total_latency_p95: median(pluck('total_latency_p95')),
    tokens_per_sec: totalTps,
    avg_context_utilization: avgCtx,
  }
}
