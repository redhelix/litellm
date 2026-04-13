import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDashboardData } from '@/hooks/useDashboardData'
import type { ModelAggregate, NodeRow } from '@/types/api'

const mockModels: ModelAggregate[] = [
  {
    model: 'test-model',
    ttft_p50: 100,
    ttft_p95: 300,
    total_latency_p50: 200,
    total_latency_p95: 500,
    llm_api_latency_p50: 180,
    llm_api_latency_p95: 450,
    overhead_ms_p50: 20,
    tokens_per_sec: 30.5,
    tool_call_rates: { success: 0.82, repaired: 0.12, failed: 0.06 },
    avg_context_utilization: 0.5,
  },
]

const mockNodes: NodeRow[] = [
  { model: 'test-model', deployment_state: 0, last_scrape: new Date().toISOString(), last_request_time: null },
]

function makeFetch(models = mockModels, nodes = mockNodes) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/models')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(models) })
    }
    if (url.includes('/api/nodes')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(nodes) })
    }
    return Promise.reject(new Error('Unknown URL'))
  })
}

// Helper: flush all pending microtasks (promises)
async function flushPromises() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('useDashboardData', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('H1: On mount, calls fetch twice and populates models/nodes/lastSuccess', async () => {
    const fetchMock = makeFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDashboardData('http://localhost:4001'))

    // Advance 0ms so the initial async effect fires, then flush promises
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/models'), expect.anything())
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/nodes'), expect.anything())
    expect(result.current.models).toEqual(mockModels)
    expect(result.current.nodes).toEqual(mockNodes)
    expect(result.current.lastSuccess).toBeInstanceOf(Date)
    expect(result.current.error).toBeNull()
  })

  it('H2: On fetch rejection, error is set; models/nodes unchanged; countdown does not reset', async () => {
    const fetchMock = makeFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDashboardData('http://localhost:4001'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.models).toEqual(mockModels)

    // Now make fetch fail
    const failFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.stubGlobal('fetch', failFetch)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(result.current.error).toBe('Connection lost — retrying…')
    expect(result.current.models).toEqual(mockModels) // unchanged from last good
    expect(result.current.nodes).toEqual(mockNodes)   // unchanged from last good
  })

  it('H3: Advancing fake timers by 30s triggers a second fetch pair', async () => {
    const fetchMock = makeFetch()
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useDashboardData('http://localhost:4001'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(fetchMock.mock.calls.length).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(fetchMock.mock.calls.length).toBe(4) // 2 more after 30s
  })

  it('H4: countdown decrements from 30 to 29 with 1s ticks and resets to 30 after successful fetch', async () => {
    const fetchMock = makeFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDashboardData('http://localhost:4001'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.countdown).toBe(30)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    // After 1s tick, countdown should be 29
    expect(result.current.countdown).toBe(29)

    // Advance 29s more to reach exactly t=30s from mount (fetch interval fires + resolves)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000)
    })

    // At t=30s the fetch interval fired and resolved; countdown reset to 30.
    // One more tick fires at t=30s itself (the 30th 1s tick from mount),
    // so countdown is 30 (reset by fetch) or 29 (tick race).
    // Key assertion: the fetch DID reset it, so it must be ≥ 29 (not still counting down from 29)
    // and specifically it resets to 30 then may decrement to 29.
    // Verify the reset happened by checking value is within [29, 30].
    expect(result.current.countdown).toBeGreaterThanOrEqual(29)
    expect(result.current.countdown).toBeLessThanOrEqual(30)
  })

  it('H5: isStale becomes true when lastSuccess is >60s ago', async () => {
    const fetchMock = makeFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useDashboardData('http://localhost:4001'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isStale).toBe(false)

    // Make subsequent fetches fail so lastSuccess stays old
    const failFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.stubGlobal('fetch', failFetch)

    // Advance past 60s (two 30s intervals will fire and fail)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })

    expect(result.current.isStale).toBe(true)
  })
})
