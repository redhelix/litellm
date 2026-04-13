import { describe, it, expect } from 'vitest'
import { deriveStatus } from '@/lib/status'

const nowISO = () => new Date().toISOString()
const agedISO = (ageMs: number) => new Date(Date.now() - ageMs).toISOString()

describe('deriveStatus', () => {
  it('S1: deployment_state=0 with fresh scrape is healthy', () => {
    expect(deriveStatus({ deployment_state: 0, last_scrape: nowISO() })).toBe('healthy')
  })

  it('S2: deployment_state=1 with fresh scrape is slow', () => {
    expect(deriveStatus({ deployment_state: 1, last_scrape: nowISO() })).toBe('slow')
  })

  it('S3: deployment_state=null with fresh scrape is unreachable', () => {
    expect(deriveStatus({ deployment_state: null, last_scrape: nowISO() })).toBe('unreachable')
  })

  it('S4: any deployment_state with last_scrape older than 90s is unknown', () => {
    expect(deriveStatus({ deployment_state: 0, last_scrape: agedISO(91_000) })).toBe('unknown')
    expect(deriveStatus({ deployment_state: 1, last_scrape: agedISO(100_000) })).toBe('unknown')
    expect(deriveStatus({ deployment_state: null, last_scrape: agedISO(200_000) })).toBe('unknown')
  })

  it('S5: unrecognized numeric/string deployment_state returns unknown', () => {
    // Live probe confirmed purely numeric values; defensive test for unexpected values
    expect(deriveStatus({ deployment_state: 99 as unknown as null, last_scrape: nowISO() })).toBe('unknown')
  })
})
