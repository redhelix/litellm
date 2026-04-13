import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusDot } from '@/components/StatusDot'
import { deriveStatus } from '@/lib/status'
import { formatRelativeTime } from '@/lib/format'
import type { NodeRow, AvailabilityStatus } from '@/types/api'

interface NodeGridProps {
  nodes: NodeRow[]
  isStale: boolean
}

const badgeVariantMap: Record<AvailabilityStatus, string> = {
  healthy: 'bg-green-500/20 text-green-400 border-green-500/30',
  slow: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  unreachable: 'bg-red-500/20 text-red-400 border-red-500/30',
  unknown: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40',
}

export function NodeGrid({ nodes, isStale }: NodeGridProps) {
  if (nodes.length === 0) {
    return (
      <section className={isStale ? 'opacity-50' : ''}>
        <h2 className="text-lg font-semibold mb-4">Nodes</h2>
        <div className="rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-sm font-medium text-zinc-300">No node data</p>
          <p className="text-xs text-zinc-500 mt-1">
            Node health data is unavailable. Prometheus scrape may not have run yet.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className={isStale ? 'opacity-50' : ''}>
      <h2 className="text-lg font-semibold mb-4">Nodes</h2>
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800">
              <TableHead>Node</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last scrape</TableHead>
              <TableHead>Last request</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => {
              const status = deriveStatus(node)
              const extraClasses = badgeVariantMap[status]
              return (
                <TableRow
                  key={node.model}
                  className="border-zinc-800 hover:bg-zinc-800"
                >
                  <TableCell className="font-mono text-sm">{node.model}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <StatusDot status={status} />
                      <Badge className={extraClasses}>{status}</Badge>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger>
                        <span className="cursor-default text-sm text-zinc-300">
                          {formatRelativeTime(node.last_scrape)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{node.last_scrape}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-300">
                    {formatRelativeTime(node.last_request_time)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
