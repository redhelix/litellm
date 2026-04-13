export interface ModelAggregate {
  model: string
  ttft_p50: number | null
  ttft_p95: number | null
  total_latency_p50: number | null
  total_latency_p95: number | null
  llm_api_latency_p50: number | null
  llm_api_latency_p95: number | null
  overhead_ms_p50: number | null
  tokens_per_sec: number | null
  tool_call_rates: {
    success: number | null
    repaired: number | null
    failed: number | null
  }
  avg_context_utilization: number | null
}

export interface NodeRow {
  model: string
  deployment_state: number | null  // 0=healthy, 1=slow, null=unreachable
  last_scrape: string
  last_request_time: string | null
}

export type AvailabilityStatus = 'healthy' | 'slow' | 'unreachable' | 'unknown'
