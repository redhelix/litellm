import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import BenchmarkRunner from '../components/BenchmarkRunner'
import { TooltipProvider } from '@/components/ui/tooltip'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ run: null, runs: [] })
  }))
})

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>)

describe('BenchmarkRunner', () => {
  it('renders section heading "Benchmark Runner"', async () => {
    wrap(<BenchmarkRunner />)
    expect(await screen.findByText('Benchmark Runner')).toBeInTheDocument()
  })

  it('renders "Run benchmark" button in idle state (BENCH-01)', async () => {
    wrap(<BenchmarkRunner />)
    expect(await screen.findByRole('button', { name: /run benchmark across all models/i })).toBeInTheDocument()
  })

  it('shows empty history message in idle state (BENCH-03)', async () => {
    wrap(<BenchmarkRunner />)
    expect(await screen.findByText(/No benchmark history/i)).toBeInTheDocument()
  })

  it('renders History section heading (BENCH-03)', async () => {
    wrap(<BenchmarkRunner />)
    expect(await screen.findByText('History')).toBeInTheDocument()
  })

  it('renders results table with TTFT column when run data present (BENCH-02)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        run: {
          run_id: 'abc',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          results: [{ model: 'gpt-4o', ttft_ms: 120, total_latency_ms: 500, tokens_per_sec: 22.5, status: 'ok' }]
        },
        runs: []
      })
    }))
    wrap(<BenchmarkRunner />)
    expect(await screen.findByText('TTFT')).toBeInTheDocument()
    expect(await screen.findByText('gpt-4o')).toBeInTheDocument()
    expect(await screen.findByText('120ms')).toBeInTheDocument()
  })
})
