import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { BenchmarkRun, BenchmarkResult } from '../types/api'

const SIDECAR_URL = import.meta.env.VITE_SIDECAR_URL ?? 'http://docker-001:4001'
const POLL_INTERVAL_MS = 5000

type RunState = 'idle' | 'running' | 'error'

function statusBadge(status: BenchmarkResult['status']) {
  const map: Record<string, string> = {
    ok:      'bg-green-500/20 text-green-400 border-green-500/30',
    error:   'bg-red-500/20 text-red-400 border-red-500/30',
    timeout: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  }
  return map[status] ?? 'bg-zinc-700/40 text-zinc-400 animate-pulse'
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function ResultsTable({ run }: { run: BenchmarkRun | null }) {
  if (!run || run.results.length === 0) return null
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead>TTFT</TableHead>
          <TableHead>Latency</TableHead>
          <TableHead>tok/s</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {run.results.map(r => (
          <TableRow key={r.model} className="hover:bg-zinc-800">
            <TableCell className="font-mono text-sm truncate max-w-[24ch]">{r.model}</TableCell>
            <TableCell className="font-mono">
              {r.ttft_ms != null ? `${r.ttft_ms}ms` : '—'}
            </TableCell>
            <TableCell className="font-mono">{r.total_latency_ms != null ? `${r.total_latency_ms}ms` : '—'}</TableCell>
            <TableCell className="font-mono">{r.tokens_per_sec != null ? `${r.tokens_per_sec.toFixed(1)} tok/s` : '—'}</TableCell>
            <TableCell>
              {r.status === 'error' && r.error_message ? (
                <Tooltip>
                  <TooltipTrigger>
                    <Badge className={statusBadge(r.status)}>{r.status}</Badge>
                  </TooltipTrigger>
                  <TooltipContent>{r.error_message}</TooltipContent>
                </Tooltip>
              ) : (
                <Badge className={statusBadge(r.status)}>{r.status}</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function BenchmarkRunner() {
  const [latestRun, setLatestRun] = useState<BenchmarkRun | null>(null)
  const [history, setHistory] = useState<BenchmarkRun[]>([])
  const [runState, setRunState] = useState<RunState>('idle')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const fetchLatest = useCallback(async () => {
    const r = await fetch(`${SIDECAR_URL}/api/benchmark/latest`)
    const d = await r.json()
    if (d.run) setLatestRun(d.run)
    return d.run
  }, [])

  const fetchHistory = useCallback(async () => {
    const r = await fetch(`${SIDECAR_URL}/api/benchmark/history?limit=10`)
    const d = await r.json()
    setHistory(d.runs ?? [])
  }, [])

  useEffect(() => {
    fetchLatest()
    fetchHistory()
  }, [fetchLatest, fetchHistory])

  useEffect(() => {
    if (runState !== 'running') return
    const timer = setInterval(async () => {
      const run = await fetchLatest()
      if (run?.completed_at) {
        setRunState('idle')
        fetchHistory()
        clearInterval(timer)
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [runState, fetchLatest, fetchHistory])

  const handleConfirmRun = async () => {
    setDialogOpen(false)
    setRunState('running')
    setError(null)
    try {
      const r = await fetch(`${SIDECAR_URL}/api/benchmark/run`, { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch {
      setRunState('error')
      setError('Benchmark failed to start — check that dashboard-sidecar is running on docker-001:4001.')
    }
  }

  const displayRun = selectedRunId
    ? history.find(r => r.run_id === selectedRunId) ?? latestRun
    : latestRun

  const isRunning = runState === 'running'

  return (
    <Card className="bg-zinc-900 border-white/10">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h2 className="text-lg font-semibold">Benchmark Runner</h2>
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger
            render={
              <Button
                size="sm"
                disabled={isRunning}
                aria-label={isRunning ? 'Benchmark in progress' : 'Run benchmark across all models'}
              />
            }
          >
            {isRunning ? 'Running…' : 'Run benchmark'}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Run benchmark across all models?</AlertDialogTitle>
              <AlertDialogDescription>
                This will fire a synthetic request at each of the deployed model endpoints. Results will be available within 60 seconds.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Don&apos;t run</AlertDialogCancel>
              <AlertDialogAction aria-label="Confirm: run benchmark" onClick={handleConfirmRun}>
                Run benchmark
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {selectedRunId && (
          <button
            className="text-sm text-zinc-400 hover:text-zinc-200 self-start"
            onClick={() => setSelectedRunId(null)}
          >
            ← Back to latest
          </button>
        )}

        <ResultsTable run={displayRun} />

        {!displayRun && !isRunning && (
          <div className="text-center py-6">
            <p className="text-sm font-medium text-zinc-400">No results yet</p>
            <p className="text-xs text-zinc-500 mt-1">No benchmarks have been run yet. Click &quot;Run benchmark&quot; to fire the first run.</p>
          </div>
        )}

        <Separator />

        <div>
          <h3 className="text-sm font-semibold mb-2">History</h3>
          {history.length === 0 && (
            <p className="text-xs text-zinc-500">No benchmark history</p>
          )}
          {history.map((run, idx) => (
            <button
              key={run.run_id}
              aria-label={`View results for Run ${history.length - idx}`}
              className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm hover:bg-zinc-800 ${selectedRunId === run.run_id ? 'bg-zinc-800' : ''}`}
              onClick={() => setSelectedRunId(run.run_id === selectedRunId ? null : run.run_id)}
            >
              <span className="text-zinc-300">Run #{history.length - idx}</span>
              <span className="text-zinc-500 text-xs">
                <Tooltip>
                  <TooltipTrigger>
                    <span>{formatRelative(run.started_at)}</span>
                  </TooltipTrigger>
                  <TooltipContent>{run.started_at}</TooltipContent>
                </Tooltip>
              </span>
              <span className="text-blue-400 text-xs">View results</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
