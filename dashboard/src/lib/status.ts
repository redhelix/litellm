import type { AvailabilityStatus } from '@/types/api'

const STALE_THRESHOLD_MS = 90_000

interface StatusInput {
  deployment_state: number | null
  last_scrape: string
}

export function deriveStatus(node: StatusInput): AvailabilityStatus {
  const scrapeAge = Date.now() - new Date(node.last_scrape).getTime()
  if (scrapeAge > STALE_THRESHOLD_MS) return 'unknown'

  // Verified from live /api/nodes probe 2026-04-13:
  // 0 = healthy, 1 = slow(?), null = unreachable
  // No string values observed — purely numeric.
  if (node.deployment_state === 0) return 'healthy'
  if (node.deployment_state === 1) return 'slow'
  if (node.deployment_state === null) return 'unreachable'

  // Defensive fallback for any unrecognised value
  return 'unknown'
}
