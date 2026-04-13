import type { AvailabilityStatus } from '@/types/api'

const colourMap: Record<AvailabilityStatus, string> = {
  healthy: 'bg-green-500',
  slow: 'bg-amber-500',
  unreachable: 'bg-red-500',
  unknown: 'bg-zinc-500',
}

interface StatusDotProps {
  status: AvailabilityStatus
}

export function StatusDot({ status }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 rounded-full ${colourMap[status]}`}
    />
  )
}
