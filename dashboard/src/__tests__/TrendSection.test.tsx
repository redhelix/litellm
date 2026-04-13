import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="recharts-linechart">{children}</div>,
  Line: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

import TrendSection from '@/components/TrendSection'

const mockTrendData = {
  model: 'gpt-4o',
  series: [
    { date: '2026-04-06', avg_latency_ms: 300, p95_latency_ms: 600, avg_context_util: 0.4, error_rate: 0.01 },
    { date: '2026-04-07', avg_latency_ms: 310, p95_latency_ms: 620, avg_context_util: 0.42, error_rate: 0.02 },
  ],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockTrendData,
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TrendSection', () => {
  it('renders sparkline rows per model', async () => {
    render(<TrendSection models={['gpt-4o']} />)
    const charts = await screen.findAllByLabelText(/trend chart/i)
    expect(charts.length).toBeGreaterThan(0)
  })

  it('7d/30d toggle triggers re-fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTrendData,
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TrendSection models={['gpt-4o']} />)
    const toggle30d = await screen.findByRole('button', { name: /30d/i })
    fireEvent.click(toggle30d)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('window=30d'))
  })
})
