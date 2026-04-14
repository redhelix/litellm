import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('M2: null fields render as em-dash or ? (ctx shows ?)', () => {
    const model = makeModel({ model: 'null-model' })
    const { container } = render(<ModelCard model={model} isStale={false} />)
    const nullValues = Array.from(container.querySelectorAll('[data-metric-value]')).filter(
      (el) => el.textContent === '—' || el.textContent === '?',
    )
    // 5 em-dashes + 1 ? for ctx% when all null
    expect(nullValues.length).toBeGreaterThanOrEqual(6)
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

  it('M6: p50 TTFT tooltip contains "50th percentile" not just the value', async () => {
    const user = userEvent.setup({ delay: null })
    render(<ModelCard model={fullModel} isStale={false} />)
    const p50Label = screen.getByText('p50 TTFT')
    await user.hover(p50Label)
    await screen.findByText(/50th percentile/i)
  })

  it('M7: p95 TTFT tooltip contains "95th percentile"', async () => {
    const user = userEvent.setup({ delay: null })
    render(<ModelCard model={fullModel} isStale={false} />)
    const p95Label = screen.getByText('p95 TTFT')
    await user.hover(p95Label)
    await screen.findByText(/95th percentile/i)
  })

  it('M8: null ctx renders "?" and tooltip contains "unknown"', async () => {
    const user = userEvent.setup({ delay: null })
    const nullCtxModel = makeModel({ model: 'null-ctx', avg_context_utilization: null })
    render(<ModelCard model={nullCtxModel} isStale={false} />)
    // The ctx% metric value should be '?'
    const ctxValue = screen.getByText('?')
    expect(ctxValue).toBeTruthy()
    // Hover the ctx% metric area to reveal tooltip
    const ctxLabel = screen.getByText('ctx %')
    await user.hover(ctxLabel)
    await screen.findByText(/unknown/i)
  })
})
