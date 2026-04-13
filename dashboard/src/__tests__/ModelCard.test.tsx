import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelCard } from '@/components/ModelCard'
import type { ModelAggregate } from '@/types/api'

function makeModel(overrides: Partial<ModelAggregate> = {}): ModelAggregate {
  return {
    model: 'test-model',
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
  }
}

const fullModel = makeModel({
  model: 'spark-nemotron-120B',
  ttft_p50: 142,
  ttft_p95: 380,
  total_latency_p50: 510,
  total_latency_p95: 1240,
  tokens_per_sec: 23.4,
  avg_context_utilization: 0.67,
  tool_call_rates: { success: 0.7, repaired: 0.2, failed: 0.1 },
})

describe('ModelCard', () => {
  it('M1: renders formatted metric values for all MET-01..05 fields', () => {
    render(<ModelCard model={fullModel} isStale={false} />)
    expect(screen.getByText('142ms')).toBeTruthy()
    expect(screen.getByText('380ms')).toBeTruthy()
    expect(screen.getByText('510ms')).toBeTruthy()
    expect(screen.getByText('1,240ms')).toBeTruthy()
    expect(screen.getByText('23.4 tok/s')).toBeTruthy()
    expect(screen.getByText('67%')).toBeTruthy()
  })

  it('M2: null fields render as em-dash "—"', () => {
    const model = makeModel({ model: 'null-model' })
    const { container } = render(<ModelCard model={model} isStale={false} />)
    const emdashes = Array.from(container.querySelectorAll('[data-metric-value]')).filter(
      (el) => el.textContent === '—',
    )
    // All 6 numeric fields should be em-dash when null
    expect(emdashes.length).toBeGreaterThanOrEqual(6)
  })

  it('M3: card has aria-label with model name and shows model alias as header', () => {
    render(<ModelCard model={fullModel} isStale={false} />)
    expect(screen.getByLabelText('Model spark-nemotron-120B')).toBeTruthy()
    expect(screen.getByText('spark-nemotron-120B')).toBeTruthy()
  })

  it('M4: ToolCallBar and Progress rendered', () => {
    const { container } = render(<ModelCard model={fullModel} isStale={false} />)
    // ToolCallBar segments present
    const segments = container.querySelectorAll('[data-segment]')
    expect(segments.length).toBe(3)
    // Progress bar present
    const progress = container.querySelector('[role="progressbar"]')
    expect(progress).toBeTruthy()
  })

  it('M5: isStale → opacity-50 on root', () => {
    const { container } = render(<ModelCard model={fullModel} isStale={true} />)
    const root = container.firstChild as HTMLElement
    expect(root.classList.contains('opacity-50')).toBe(true)
  })
})
