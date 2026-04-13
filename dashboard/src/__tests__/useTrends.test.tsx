import { renderHook, waitFor } from '@testing-library/react'
import useTrends from '@/hooks/useTrends'

const mockTrendData = {
  model: 'gpt-4o',
  series: [
    { date: '2026-04-06', avg_latency_ms: 300, p95_latency_ms: 600, avg_context_util: 0.4, error_rate: 0.01 },
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
  vi.restoreAllMocks()
})

describe('useTrends', () => {
  it('returns { data, loading, error } keyed by model', async () => {
    const { result } = renderHook(() => useTrends({ models: ['gpt-4o'], window: '7d' }))
    expect(result.current).toHaveProperty('data')
    expect(result.current).toHaveProperty('loading')
    expect(result.current).toHaveProperty('error')
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  it('aborts on unmount', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    const { unmount } = renderHook(() => useTrends({ models: ['gpt-4o'], window: '7d' }))
    unmount()
    expect(abortSpy).toHaveBeenCalled()
  })

  it('sets loading true then false on success', async () => {
    const { result } = renderHook(() => useTrends({ models: ['gpt-4o'], window: '7d' }))
    expect(result.current.loading).toBe(true)
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })
})
