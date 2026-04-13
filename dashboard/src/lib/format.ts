export function formatMs(v: number | null): string {
  if (v === null) return '—'
  return Math.round(v).toLocaleString('en-US') + 'ms'
}

export function formatTokensPerSec(v: number | null): string {
  if (v === null) return '—'
  return v.toFixed(1) + ' tok/s'
}

export function formatContextPct(v: number | null): string {
  if (v === null) return '—'
  return Math.round(v * 100) + '%'
}

export function formatRelativeTime(iso: string | null): string {
  if (iso === null) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr}h ago`
}
