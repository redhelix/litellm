import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { NodeGrid } from '@/components/NodeGrid'
import { StatusDot } from '@/components/StatusDot'
import type { NodeRow } from '@/types/api'

// Fixed "now" for deterministic relative-time tests
const NOW = new Date('2026-04-13T12:00:00.000Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

function makeNode(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    model: 'test-model',
    deployment_state: 0,
    last_scrape: new Date(NOW - 10_000).toISOString(), // 10s ago — fresh
    last_request_time: new Date(NOW - 30_000).toISOString(),
    ...overrides,
  }
}

// ─── StatusDot ───────────────────────────────────────────────────────────────

describe('StatusDot', () => {
  it('D1: healthy → bg-green-500 + aria-hidden + h-2 w-2', () => {
    const { container } = render(<StatusDot status="healthy" />)
    const el = container.firstChild as HTMLElement
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.classList.contains('bg-green-500')).toBe(true)
    expect(el.classList.contains('h-2')).toBe(true)
    expect(el.classList.contains('w-2')).toBe(true)
  })

  it('D2: slow → bg-amber-500', () => {
    const { container } = render(<StatusDot status="slow" />)
    const el = container.firstChild as HTMLElement
    expect(el.classList.contains('bg-amber-500')).toBe(true)
  })

  it('D3: unreachable → bg-red-500', () => {
    const { container } = render(<StatusDot status="unreachable" />)
    const el = container.firstChild as HTMLElement
    expect(el.classList.contains('bg-red-500')).toBe(true)
  })

  it('D4: unknown → bg-zinc-500', () => {
    const { container } = render(<StatusDot status="unknown" />)
    const el = container.firstChild as HTMLElement
    expect(el.classList.contains('bg-zinc-500')).toBe(true)
  })
})

// ─── NodeGrid ─────────────────────────────────────────────────────────────────

describe('NodeGrid', () => {
  it('N1: renders 5 data rows + 1 header row for 5 inputs', () => {
    const nodes = Array.from({ length: 5 }, (_, i) => makeNode({ model: `model-${i}` }))
    const { container } = render(<NodeGrid nodes={nodes} isStale={false} />)
    const rows = container.querySelectorAll('tr')
    // 1 header + 5 data rows = 6 total
    expect(rows.length).toBe(6)
  })

  it('N2: columns are Node, Status, Last scrape, Last request', () => {
    const nodes = [makeNode()]
    render(<NodeGrid nodes={nodes} isStale={false} />)
    expect(screen.getByText('Node')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Last scrape')).toBeTruthy()
    expect(screen.getByText('Last request')).toBeTruthy()
  })

  it('N3: healthy node (deployment_state=0, fresh scrape) → badge text "healthy"', () => {
    const node = makeNode({ deployment_state: 0 })
    render(<NodeGrid nodes={[node]} isStale={false} />)
    expect(screen.getByText('healthy')).toBeTruthy()
  })

  it('N4: stale scrape (120s ago) → badge "unknown" regardless of deployment_state', () => {
    const node = makeNode({
      deployment_state: 0,
      last_scrape: new Date(NOW - 120_000).toISOString(), // 120s ago > 90s threshold
    })
    render(<NodeGrid nodes={[node]} isStale={false} />)
    expect(screen.getByText('unknown')).toBeTruthy()
  })

  it('N5: last_request_time=null → cell text "never"', () => {
    const node = makeNode({ last_request_time: null })
    render(<NodeGrid nodes={[node]} isStale={false} />)
    expect(screen.getByText('never')).toBeTruthy()
  })

  it('N6: empty nodes=[] → shows empty-state text', () => {
    render(<NodeGrid nodes={[]} isStale={false} />)
    expect(screen.getByText('No node data')).toBeTruthy()
  })

  it('N7: isStale=true → root element has opacity-50', () => {
    const nodes = [makeNode()]
    const { container } = render(<NodeGrid nodes={nodes} isStale={true} />)
    const root = container.firstChild as HTMLElement
    expect(root.classList.contains('opacity-50')).toBe(true)
  })
})
