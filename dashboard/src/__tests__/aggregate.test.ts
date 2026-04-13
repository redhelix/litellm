import { describe, it, expect } from 'vitest'
import { computeOverview } from '@/lib/aggregate'
import type { ModelAggregate } from '@/types/api'

const makeModel = (overrides: Partial<ModelAggregate> = {}): ModelAggregate => ({
  model: 'test',
  ttft_p50: null,
  ttft_p95: null,
  total_latency_p50: null,
  total_latency_p95: null,
  llm_api_latency_p50: null,
  llm_api_latency_p95: null,
  overhead_ms_p50: null,
  tokens_per_sec: null,
  tool_call_rates: { success: null, repaired: null, failed: null },
  avg_context_utilization: null,
  ...overrides,
})

describe('computeOverview', () => {
  it('A1: empty array returns nulls and tokens_per_sec=0', () => {
    const result = computeOverview([])
    expect(result.ttft_p50).toBeNull()
    expect(result.total_latency_p50).toBeNull()
    expect(result.tokens_per_sec).toBe(0)
    expect(result.avg_context_utilization).toBeNull()
  })

  it('A2: median of [100, 200, 300] p50 is 200', () => {
    const models = [
      makeModel({ ttft_p50: 100 }),
      makeModel({ ttft_p50: 300 }),
      makeModel({ ttft_p50: 200 }),
    ]
    const result = computeOverview(models)
    expect(result.ttft_p50).toBe(200)
  })

  it('A3: null entries filtered before median', () => {
    const models = [
      makeModel({ ttft_p50: null }),
      makeModel({ ttft_p50: 100 }),
      makeModel({ ttft_p50: 200 }),
    ]
    const result = computeOverview(models)
    // median of [100, 200] = 150
    expect(result.ttft_p50).toBe(150)
  })

  it('A4: tokens_per_sec is SUM of non-null values', () => {
    const models = [
      makeModel({ tokens_per_sec: 10 }),
      makeModel({ tokens_per_sec: 20 }),
      makeModel({ tokens_per_sec: null }),
    ]
    const result = computeOverview(models)
    expect(result.tokens_per_sec).toBe(30)
  })

  it('A5: avg_context_utilization is arithmetic mean of non-null values', () => {
    const models = [
      makeModel({ avg_context_utilization: 0.4 }),
      makeModel({ avg_context_utilization: 0.6 }),
      makeModel({ avg_context_utilization: null }),
    ]
    const result = computeOverview(models)
    expect(result.avg_context_utilization).toBeCloseTo(0.5)
  })
})
