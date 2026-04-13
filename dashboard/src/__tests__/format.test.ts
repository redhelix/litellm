import { describe, it, expect } from 'vitest'
import { formatMs, formatTokensPerSec, formatContextPct, formatRelativeTime } from '@/lib/format'

describe('formatMs', () => {
  it('F1a: formats small values', () => {
    expect(formatMs(142)).toBe('142ms')
  })
  it('F1b: formats large values with comma', () => {
    expect(formatMs(1240)).toBe('1,240ms')
  })
  it('F1c: null returns em-dash', () => {
    expect(formatMs(null)).toBe('—')
  })
})

describe('formatTokensPerSec', () => {
  it('F2a: formats with 1 decimal', () => {
    expect(formatTokensPerSec(23.4)).toBe('23.4 tok/s')
  })
  it('F2b: null returns em-dash', () => {
    expect(formatTokensPerSec(null)).toBe('—')
  })
  it('F2c: rounds to 1 decimal', () => {
    expect(formatTokensPerSec(23.46)).toBe('23.5 tok/s')
  })
})

describe('formatContextPct', () => {
  it('F3a: formats fraction as percentage', () => {
    expect(formatContextPct(0.67)).toBe('67%')
  })
  it('F3b: null returns em-dash', () => {
    expect(formatContextPct(null)).toBe('—')
  })
  it('F3c: 1.0 returns 100%', () => {
    expect(formatContextPct(1)).toBe('100%')
  })
})

describe('formatRelativeTime', () => {
  it('F4a: formats 3 minutes ago', () => {
    const iso = new Date(Date.now() - 180_000).toISOString()
    expect(formatRelativeTime(iso)).toBe('3 min ago')
  })
  it('F4b: null returns never', () => {
    expect(formatRelativeTime(null)).toBe('never')
  })
})
