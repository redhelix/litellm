interface RefreshRingProps {
  countdown: number
  error: string | null
  isStale: boolean
}

export function RefreshRing({ countdown, error, isStale }: RefreshRingProps) {
  const radius = 14
  const circumference = 2 * Math.PI * radius
  const progress = countdown / 30
  const dashOffset = circumference * (1 - progress)

  const showBanner = error || isStale
  const bannerText = error ?? (isStale ? 'Data may be stale' : '')

  return (
    <div className="flex items-center gap-3">
      {showBanner && (
        <p
          className="text-amber-500 text-sm"
          aria-live="polite"
        >
          {bannerText}
        </p>
      )}
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        aria-label={`Auto-refreshes in ${countdown} seconds`}
        role="img"
      >
        {/* Track */}
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="#3f3f46"
          strokeWidth="3"
        />
        {/* Progress arc */}
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke={error ? '#f59e0b' : '#3b82f6'}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={error ? circumference : dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 18 18)"
        />
        <text
          x="18"
          y="18"
          textAnchor="middle"
          dominantBaseline="central"
          className="text-[10px] fill-zinc-300"
          fontSize="10"
          fill="#d4d4d8"
        >
          {error ? '!' : countdown}
        </text>
      </svg>
    </div>
  )
}
