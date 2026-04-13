import { renderHook, waitFor } from '@testing-library/react'
import useRequestLog from '@/hooks/useRequestLog'

const mockResponse = { rows: [], total: 0 }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockResponse,
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useRequestLog', () => {
  it('returns { data, loading, error }', async () => {
    const { result } = renderHook(() => useRequestLog({ window: '30d', limit: 25, offset: 0 }))
    expect(result.current).toHaveProperty('data')
    expect(result.current).toHaveProperty('loading')
    expect(result.current).toHaveProperty('error')
  })

  it('sets loading true then false on success', async () => {
    const { result } = renderHook(() => useRequestLog({ window: '30d', limit: 25, offset: 0 }))
    expect(result.current.loading).toBe(true)
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  it('aborts in-flight fetch when params change', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    const { rerender } = renderHook(
      ({ offset }: { offset: number }) => useRequestLog({ window: '30d', limit: 25, offset }),
      { initialProps: { offset: 0 } },
    )
    rerender({ offset: 25 })
    expect(abortSpy).toHaveBeenCalled()
  })
})
