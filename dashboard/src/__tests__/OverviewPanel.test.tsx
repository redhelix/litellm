import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OverviewPanel } from '@/components/OverviewPanel'
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

describe('OverviewPanel', () => {
  it('O1: TTFT p50 shows median and p95 total latency shows median', () => {
    const models = [
      makeModel({ ttft_p50: 100, ttft_p95: 300, total_latency_p50: null, total_latency_p95: 300 }),
      makeModel({ ttft_p50: 200, ttft_p95: 500, total_latency_p50: null, total_latency_p95: 500 }),
      makeModel({ ttft_p50: 300, ttft_p95: 800, total_latency_p50: null, total_latency_p95: 800 }),
    ]
    render(<OverviewPanel models={models} isStale={false} />)
    // p50 TTFT median of [100,200,300] = 200ms
    expect(screen.getByLabelText('Overview p50 TTFT')).toHaveTextContent('200ms')
    // p95 total latency median of [300,500,800] = 500ms
    expect(screen.getByLabelText('Overview p95 total latency')).toHaveTextContent('500ms')
  })

  it('O2: tokens_per_sec cell shows SUM of non-null values', () => {
    const models = [
      makeModel({ tokens_per_sec: 10.5 }),
      makeModel({ tokens_per_sec: 20.0 }),
      makeModel({ tokens_per_sec: null }),
    ]
    render(<OverviewPanel models={models} isStale={false} />)
    expect(screen.getByLabelText('Overview Tokens/sec')).toHaveTextContent('30.5 tok/s')
  })

  it('O3: avg_context_utilization shows mean * 100 with %', () => {
    const models = [
      makeModel({ avg_context_utilization: 0.5 }),
      makeModel({ avg_context_utilization: 0.7 }),
    ]
    render(<OverviewPanel models={models} isStale={false} />)
    // (0.5+0.7)/2 = 0.6 → 60%
    expect(screen.getByLabelText('Overview Context %')).toHaveTextContent('60%')
  })

  it('O4: Tool call aggregate bar renders with averaged rates', () => {
    const models = [
      makeModel({ tool_call_rates: { success: 0.8, repaired: 0.1, failed: 0.1 } }),
      makeModel({ tool_call_rates: { success: 0.6, repaired: 0.2, failed: 0.2 } }),
    ]
    const { container } = render(<OverviewPanel models={models} isStale={false} />)
    // averaged: success=0.7, repaired=0.15, failed=0.15
    const segments = container.querySelectorAll('[data-segment]')
    expect(segments.length).toBe(3)
  })

  it('O5: Empty models renders em-dashes or ? and no-data tool call bar', () => {
    const { container } = render(<OverviewPanel models={[]} isStale={false} />)
    // Numeric metrics show "—" or "?" (ctx% shows ? when null)
    const metricValues = Array.from(container.querySelectorAll('[data-metric-value]'))
    const nullValues = metricValues.filter((el) => el.textContent === '—' || el.textContent === '?')
    expect(nullValues.length).toBeGreaterThanOrEqual(3)
    // Tool call bar in no-data state
    const noData = container.querySelector('[data-no-data]')
    expect(noData).toBeTruthy()
  })

  it('O6: isStale prop applies opacity-50 to root element', () => {
    const { container } = render(<OverviewPanel models={[]} isStale={true} />)
    const root = container.firstChild as HTMLElement
    expect(root.classList.contains('opacity-50')).toBe(true)
  })

  it('O7: Cards have aria-label prefixed with "Overview "', () => {
    render(<OverviewPanel models={[]} isStale={false} />)
    expect(screen.getByLabelText('Overview p50 TTFT')).toBeTruthy()
    expect(screen.getByLabelText('Overview p95 total latency')).toBeTruthy()
    expect(screen.getByLabelText('Overview Tokens/sec')).toBeTruthy()
    expect(screen.getByLabelText('Overview Context %')).toBeTruthy()
    expect(screen.getByLabelText('Overview Tool calls')).toBeTruthy()
  })

  it('O8: p50 TTFT label has tooltip containing "50th percentile"', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OverviewPanel models={[makeModel({ ttft_p50: 100 })]} isStale={false} />)
    const label = screen.getByText('p50 TTFT')
    await user.hover(label)
    await screen.findByText(/50th percentile/i)
  })

  it('O9: p95 total latency label tooltip contains "1 in 20"', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OverviewPanel models={[makeModel({ total_latency_p95: 500 })]} isStale={false} />)
    const label = screen.getByText('p95 total latency')
    await user.hover(label)
    await screen.findByText(/1 in 20/i)
  })

  it('O10: Context % label tooltip contains "context window"', async () => {
    const user = userEvent.setup({ delay: null })
    render(<OverviewPanel models={[makeModel({ avg_context_utilization: 0.5 })]} isStale={false} />)
    const label = screen.getByText('Context %')
    await user.hover(label)
    await screen.findByText(/context window/i)
  })

  it('O11: null avg_context_utilization renders "?" not em-dash in Context % card', () => {
    render(<OverviewPanel models={[makeModel({ avg_context_utilization: null })]} isStale={false} />)
    const ctxCard = screen.getByLabelText('Overview Context %')
    expect(ctxCard.textContent).toContain('?')
    expect(ctxCard.textContent).not.toContain('—')
  })
})
