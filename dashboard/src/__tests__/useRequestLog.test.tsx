import { renderHook, waitFor } from '@testing-library/react'
import useRequestLog from '@/hooks/useRequestLog'

const mockResponse = { rows: [], total: 0 }

let lastFetchUrl = ''

beforeEach(() => {
  lastFetchUrl = ''
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    lastFetchUrl = url
    return Promise.resolve({
      ok: true,
      json: async () => mockResponse,
    })
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

  it('S1: sortBy and sortDir are forwarded as snake_case params', async () => {
    const { result } = renderHook(() =>
      useRequestLog({ window: '30d', limit: 25, offset: 0, sortBy: 'ttft_ms', sortDir: 'asc' }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(lastFetchUrl).toContain('sort_by=ttft_ms')
    expect(lastFetchUrl).toContain('sort_dir=asc')
  })

  it('S2: statusFilter is forwarded as status_filter', async () => {
    const { result } = renderHook(() =>
      useRequestLog({ window: '30d', limit: 25, offset: 0, statusFilter: 'failed' }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(lastFetchUrl).toContain('status_filter=failed')
  })

  it('S3: omitting sort/filter params produces URL without those keys', async () => {
    const { result } = renderHook(() =>
      useRequestLog({ window: '30d', limit: 25, offset: 0 }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(lastFetchUrl).not.toContain('sort_by')
    expect(lastFetchUrl).not.toContain('sort_dir')
    expect(lastFetchUrl).not.toContain('status_filter')
  })

  it('S4: changing sortBy triggers a new fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResponse })
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = renderHook(
      ({ sortBy }: { sortBy: 'startTime' | 'ttft_ms' }) =>
        useRequestLog({ window: '30d', limit: 25, offset: 0, sortBy }),
      { initialProps: { sortBy: 'startTime' as const } },
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    rerender({ sortBy: 'ttft_ms' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
