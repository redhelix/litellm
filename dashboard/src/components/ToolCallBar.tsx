interface ToolCallBarProps {
  success: number | null
  repaired: number | null
  failed: number | null
}

export function ToolCallBar({ success, repaired, failed }: ToolCallBarProps) {
  const allNull = success === null && repaired === null && failed === null

  if (allNull) {
    return (
      <div
        role="img"
        aria-label="Tool call data unavailable"
        className="flex h-3 w-full overflow-hidden rounded-sm"
      >
        <div data-no-data className="bg-zinc-800 h-full w-full" />
      </div>
    )
  }

  const s = success ?? 0
  const r = repaired ?? 0
  const f = failed ?? 0
  const total = s + r + f

  // Normalise so widths sum to 100
  const normalize = (v: number) => (total === 0 ? 0 : Math.round((v / total) * 100))

  const sw = normalize(s)
  const rw = normalize(r)
  // Ensure exact 100 sum by computing failed as remainder
  const fw = 100 - sw - rw

  const label = `Tool calls: success ${sw}%, repaired ${rw}%, failed ${fw}%`

  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-3 w-full overflow-hidden rounded-sm"
    >
      <div
        data-segment
        className="bg-green-500 h-full"
        style={{ width: `${sw}%` }}
        title={`success ${sw}%`}
        aria-label={`success ${sw}%`}
      />
      <div
        data-segment
        className="bg-amber-500 h-full"
        style={{ width: `${rw}%` }}
        title={`repaired ${rw}%`}
        aria-label={`repaired ${rw}%`}
      />
      <div
        data-segment
        className="bg-red-500 h-full"
        style={{ width: `${fw}%` }}
        title={`failed ${fw}%`}
        aria-label={`failed ${fw}%`}
      />
    </div>
  )
}
