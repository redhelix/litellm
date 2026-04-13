import { render, screen, fireEvent } from '@testing-library/react'
import RequestLogTable from '@/components/RequestLogTable'

const mockRows = [
  {
    id: '1',
    model: 'gpt-4o',
    ttft_ms: 123,
    total_latency_ms: 456,
    context_utilization: 0.42,
    tool_call_status: 'success',
    timestamp: '2026-04-13T10:00:00Z',
  },
  {
    id: '2',
    model: 'gpt-4o',
    ttft_ms: null,
    total_latency_ms: 200,
    context_utilization: 0.1,
    tool_call_status: null,
    timestamp: '2026-04-13T11:00:00Z',
  },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ rows: mockRows, total: 2 }),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RequestLogTable', () => {
  it('renders rows from mock data', async () => {
    render(<RequestLogTable />)
    const rows = await screen.findAllByRole('row')
    // header row + 2 data rows = 3
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  it('Prev button is disabled on page 1', async () => {
    render(<RequestLogTable />)
    const prevBtn = await screen.findByRole('button', { name: /prev/i })
    expect(prevBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('model filter change resets to page 1', async () => {
    render(<RequestLogTable />)
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: 'gpt-4o' } })
    const prevBtn = await screen.findByRole('button', { name: /prev/i })
    expect(prevBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('null numeric values render as em-dash', async () => {
    render(<RequestLogTable />)
    const cells = await screen.findAllByText('—')
    expect(cells.length).toBeGreaterThan(0)
  })
})
