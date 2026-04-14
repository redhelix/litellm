import { useState } from 'react'
import { useRequestLog } from '@/hooks/useRequestLog'
import type { RequestLogRow } from '@/types/api'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

interface RequestLogTableProps {
  sidecarUrl?: string
  modelOptions?: string[]
}

function fmtMs(v: number | null): string {
  return v == null ? '—' : `${Math.round(v)}ms`
}

function fmtPct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

const badgeClass: Record<string, string> = {
  success: 'bg-green-500/20 text-green-400 border border-green-500/30',
  repaired: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  failed: 'bg-red-500/20 text-red-400 border border-red-500/30',
}

function ToolBadge({ status }: { status: RequestLogRow['tool_call_status'] }) {
  const cls = status ? badgeClass[status] : 'bg-zinc-700/40 text-zinc-400 border border-zinc-600/40'
  return <Badge className={`text-xs px-1.5 py-0.5 rounded ${cls}`}>{status ?? '—'}</Badge>
}

function RelativeTime({ iso }: { iso: string }) {
  const date = new Date(iso)
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  let rel: string
  if (diffMin < 1) rel = 'just now'
  else if (diffMin < 60) rel = `${diffMin}m ago`
  else if (diffHr < 24) rel = `${diffHr}h ago`
  else rel = `${Math.floor(diffHr / 24)}d ago`

  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="text-xs text-zinc-400 cursor-default">{rel}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="text-xs font-mono">{iso}</span>
      </TooltipContent>
    </Tooltip>
  )
}

export function RequestLogTable({ sidecarUrl = '', modelOptions = [] }: RequestLogTableProps) {
  const [page, setPage] = useState(1)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'startTime' | 'ttft_ms' | 'total_latency_ms'>('startTime')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState<'success' | 'repaired' | 'failed' | null>(null)

  const limit = 25
  const offset = (page - 1) * limit

  const { data, loading, error } = useRequestLog({
    sidecarUrl,
    model: selectedModel,
    limit,
    offset,
    sortBy,
    sortDir,
    statusFilter,
  })

  const totalPages = Math.ceil((data?.total ?? 0) / limit)
  const isFirstPage = page === 1
  const isLastPage = page >= totalPages || totalPages === 0

  function handleModelChange(value: string | null) {
    setSelectedModel(value === '__all__' || value === null ? null : value)
    setPage(1)
  }

  function handleStatusChange(value: string) {
    setStatusFilter(value === '__all__' ? null : value as 'success' | 'repaired' | 'failed')
    setPage(1)
  }

  function handlePrev() {
    if (!isFirstPage) {
      setPage(p => p - 1)
      document.getElementById('request-log')?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  function handleNext() {
    if (!isLastPage) {
      setPage(p => p + 1)
      document.getElementById('request-log')?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  function SortableHeader({ label, column }: { label: string; column: 'startTime' | 'ttft_ms' | 'total_latency_ms' }) {
    const active = sortBy === column
    const arrow = active ? (sortDir === 'asc' ? '↑' : '↓') : ''
    return (
      <button
        type="button"
        className="text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1"
        aria-label={`Sort by ${label}`}
        onClick={() => {
          if (active) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc')
          } else {
            setSortBy(column)
            setSortDir('desc')
          }
          setPage(1)
        }}
      >
        {label} <span aria-hidden="true">{arrow}</span>
      </button>
    )
  }

  const rows = data?.rows ?? []

  return (
    <div id="request-log">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Request Log</h2>
        <div className="flex gap-2">
          <Select
            value={selectedModel ?? '__all__'}
            onValueChange={handleModelChange}
          >
            <SelectTrigger className="w-48" aria-label="Filter by model">
              <SelectValue placeholder="All models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All models</SelectItem>
              {modelOptions.map(m => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter ?? '__all__'}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="w-44" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="success">success</SelectItem>
              <SelectItem value="repaired">repaired</SelectItem>
              <SelectItem value="failed">failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 mb-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-zinc-800 p-8 text-center animate-pulse">
          <p className="text-sm text-zinc-500">Loading...</p>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-lg border border-zinc-800 p-8 text-center">
          {selectedModel ? (
            <>
              <p className="text-sm font-medium text-zinc-300">No requests for this model</p>
              <p className="text-xs text-zinc-500 mt-1">
                Try selecting a different model or clearing the filter.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-zinc-300">No requests yet</p>
              <p className="text-xs text-zinc-500 mt-1">
                Request log will populate once LiteLLM processes requests.
              </p>
            </>
          )}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800">
                <TableHead className="text-zinc-400">Model</TableHead>
                <TableHead className="text-zinc-400">
                  <SortableHeader label="TTFT" column="ttft_ms" />
                </TableHead>
                <TableHead className="text-zinc-400">
                  <SortableHeader label="Latency" column="total_latency_ms" />
                </TableHead>
                <TableHead className="text-zinc-400">Ctx%</TableHead>
                <TableHead className="text-zinc-400">Tool Call</TableHead>
                <TableHead className="text-zinc-400">
                  <SortableHeader label="Time" column="startTime" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                const key = (row as { request_id?: string; id?: string }).request_id
                  ?? (row as { request_id?: string; id?: string }).id
                  ?? String(i)
                const startTime = (row as { startTime?: string; timestamp?: string }).startTime
                  ?? (row as { startTime?: string; timestamp?: string }).timestamp
                  ?? ''
                const hasError = !!row.error_message
                return (
                  <TableRow key={key} className={`border-zinc-800 ${hasError ? 'bg-red-500/10' : ''}`}>
                    <TableCell className="font-mono text-xs">
                      {hasError ? (
                        <Tooltip>
                          <TooltipTrigger aria-label={row.error_message ?? undefined}>
                            <span className="cursor-default">{row.model}</span>
                          </TooltipTrigger>
                          <TooltipContent>{row.error_message}</TooltipContent>
                        </Tooltip>
                      ) : row.model}
                    </TableCell>
                    <TableCell className="text-xs">{fmtMs(row.ttft_ms)}</TableCell>
                    <TableCell className="text-xs">{fmtMs(row.total_latency_ms)}</TableCell>
                    <TableCell className="text-xs">
                      {row.context_utilization == null ? (
                        <Tooltip>
                          <TooltipTrigger><span className="cursor-default">?</span></TooltipTrigger>
                          <TooltipContent>Context window size unknown for this model alias</TooltipContent>
                        </Tooltip>
                      ) : fmtPct(row.context_utilization)}
                    </TableCell>
                    <TableCell><ToolBadge status={row.tool_call_status} /></TableCell>
                    <TableCell><RelativeTime iso={startTime} /></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrev}
          disabled={isFirstPage}
          aria-disabled={isFirstPage ? 'true' : 'false'}
          aria-label="Previous page"
          className={isFirstPage ? 'opacity-50 cursor-not-allowed' : ''}
        >
          ← Prev
        </Button>
        <span className="text-xs text-zinc-500" aria-live="polite">
          Page {page} {totalPages > 0 ? `of ${totalPages}` : ''}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleNext}
          disabled={isLastPage}
          aria-disabled={isLastPage ? 'true' : 'false'}
          aria-label="Next page"
          className={isLastPage ? 'opacity-50 cursor-not-allowed' : ''}
        >
          Next →
        </Button>
      </div>
    </div>
  )
}

export default RequestLogTable
