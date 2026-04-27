import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RefreshCw, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import type {
  BenchmarkRun, BenchmarkResult, BenchmarkTaskResultsMap, BenchmarkStatus,
} from '../types/api'

const SIDECAR_URL = import.meta.env.VITE_SIDECAR_URL ?? 'http://docker-001:4001'
const POLL_MS = 5000

type Tier  = 'short' | 'full'
type Scope = 'local' | 'cloud' | 'all'
type SortDir = 'asc' | 'desc'

const SCOPE_LABELS: Record<Scope, string> = {
  local: 'Local only',
  cloud: 'Cloud only',
  all:   'All models',
}

const TASK_DOMAINS = [
  { key: 'reasoning',   label: 'Reasoning' },
  { key: 'instruction', label: 'Instruction' },
  { key: 'coding',      label: 'Coding' },
  { key: 'drafting',    label: 'Drafting' },
  { key: 'tool_call',   label: 'Tool Call' },
] as const
type DomainKey = typeof TASK_DOMAINS[number]['key']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function statusBadgeCls(status: BenchmarkResult['status']) {
  const map: Record<string, string> = {
    ok:      'bg-green-500/20 text-green-400 border-green-500/30',
    error:   'bg-red-500/20 text-red-400 border-red-500/30',
    timeout: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  }
  return map[status] ?? 'bg-zinc-700/40 text-zinc-400'
}

function scoreCls(score: number | null | undefined): string {
  if (score == null) return 'text-zinc-500'
  if (score >= 7) return 'text-green-400'
  if (score >= 5) return 'text-amber-400'
  return 'text-red-400'
}

function domainScore(model: string, domain: DomainKey, taskMap: BenchmarkTaskResultsMap): number | null {
  const domains = taskMap[model]
  if (!domains) return null
  const entries = Object.entries(domains).filter(([k]) => k.startsWith(domain))
  if (entries.length === 0) return null
  const scores = entries.filter(([, r]) => !r.skipped && r.score != null).map(([, r]) => r.score as number)
  if (scores.length === 0) return null
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

function avgScore(model: string, taskMap: BenchmarkTaskResultsMap): number | null {
  const domains = taskMap[model]
  if (!domains) return null
  const scores = Object.values(domains).filter(r => !r.skipped && r.score != null).map(r => r.score as number)
  if (scores.length === 0) return null
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

function DeltaBadge({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return null
  const delta = current - previous
  if (Math.abs(delta) < 0.05) return null
  return (
    <span className={`ml-1 text-[10px] font-semibold ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
      {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(1)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Sort indicator
// ---------------------------------------------------------------------------
function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="size-3 text-zinc-600 inline ml-1" />
  return dir === 'asc'
    ? <ArrowUp className="size-3 text-zinc-300 inline ml-1" />
    : <ArrowDown className="size-3 text-zinc-300 inline ml-1" />
}

// ---------------------------------------------------------------------------
// Filter toolbar
// ---------------------------------------------------------------------------
function FilterBar({
  search, onSearch, children,
}: {
  search: string
  onSearch: (v: string) => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <input
        type="search"
        placeholder="Filter models…"
        value={search}
        onChange={e => onSearch(e.target.value)}
        className="h-7 px-2 text-xs rounded border border-zinc-700 bg-zinc-800 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 w-44"
      />
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Perf table (short benchmark)
// ---------------------------------------------------------------------------
type PerfSortKey = 'model' | 'ttft_ms' | 'total_latency_ms' | 'tokens_per_sec'

function PerfTable({ run, prevRun }: { run: BenchmarkRun; prevRun: BenchmarkRun | null }) {
  const [search, setSearch]   = useState('')
  const [sortKey, setSortKey] = useState<PerfSortKey>('ttft_ms')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const prevByModel = new Map(prevRun?.results.map(r => [r.model, r]) ?? [])

  function handleSort(key: PerfSortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const rows = useMemo(() => {
    let r = run.results
    if (search) r = r.filter(x => x.model.toLowerCase().includes(search.toLowerCase()))
    if (statusFilter !== 'all') r = r.filter(x => x.status === statusFilter)
    return [...r].sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'model') return mul * a.model.localeCompare(b.model)
      const av = a[sortKey] ?? Infinity
      const bv = b[sortKey] ?? Infinity
      return mul * (av - bv)
    })
  }, [run.results, search, statusFilter, sortKey, sortDir])

  const statuses = useMemo(() => ['all', ...new Set(run.results.map(r => r.status))], [run.results])

  function Th({ label, col }: { label: string; col: PerfSortKey }) {
    return (
      <TableHead className="cursor-pointer select-none" onClick={() => handleSort(col)}>
        {label}<SortIcon active={sortKey === col} dir={sortDir} />
      </TableHead>
    )
  }

  return (
    <>
      <FilterBar search={search} onSearch={setSearch}>
        <div className="flex gap-1">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors capitalize
                ${statusFilter === s ? 'bg-zinc-700 border-zinc-500 text-zinc-100' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </FilterBar>
      <Table>
        <TableHeader>
          <TableRow>
            <Th label="Model" col="model" />
            <Th label="TTFT" col="ttft_ms" />
            <Th label="Latency" col="total_latency_ms" />
            <Th label="tok/s" col="tokens_per_sec" />
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center text-zinc-500 text-xs py-6">No results match filter</TableCell></TableRow>
          )}
          {rows.map(r => {
            const prev = prevByModel.get(r.model)
            return (
              <TableRow key={r.model} className="hover:bg-zinc-800">
                <TableCell className="font-mono text-sm truncate max-w-[24ch]">{r.model}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.ttft_ms != null ? <span>{r.ttft_ms}ms<DeltaBadge current={r.ttft_ms} previous={prev?.ttft_ms ?? null} /></span> : '—'}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {r.total_latency_ms != null ? `${r.total_latency_ms}ms` : '—'}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {r.tokens_per_sec != null
                    ? <span>{r.tokens_per_sec.toFixed(1)}<DeltaBadge current={r.tokens_per_sec} previous={prev?.tokens_per_sec ?? null} /></span>
                    : '—'}
                </TableCell>
                <TableCell>
                  {r.status === 'error' && r.error_message ? (
                    <Tooltip>
                      <TooltipTrigger><Badge className={statusBadgeCls(r.status)}>{r.status}</Badge></TooltipTrigger>
                      <TooltipContent>{r.error_message}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Badge className={statusBadgeCls(r.status)}>{r.status}</Badge>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </>
  )
}

// ---------------------------------------------------------------------------
// Capability table (full benchmark)
// ---------------------------------------------------------------------------
type CapSortKey = 'model' | 'avg' | DomainKey

function CapabilityTable({
  run, taskMap, prevTaskMap,
}: {
  run: BenchmarkRun
  taskMap: BenchmarkTaskResultsMap
  prevTaskMap: BenchmarkTaskResultsMap | null
}) {
  const [search, setSearch]   = useState('')
  const [sortKey, setSortKey] = useState<CapSortKey>('avg')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const perfByModel = new Map(run.results.map(r => [r.model, r]))
  // Full runs write only to benchmark_task_results, not benchmark_results — fall back to taskMap keys
  const allModels = run.results.length > 0 ? run.results.map(r => r.model) : Object.keys(taskMap)

  function handleSort(key: CapSortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const rows = useMemo(() => {
    let models = allModels.slice()
    if (search) models = models.filter(m => m.toLowerCase().includes(search.toLowerCase()))
    return models.sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'model') return mul * a.localeCompare(b)
      if (sortKey === 'avg') {
        const av = avgScore(a, taskMap) ?? -Infinity
        const bv = avgScore(b, taskMap) ?? -Infinity
        return mul * (av - bv)
      }
      const av = domainScore(a, sortKey as DomainKey, taskMap) ?? -Infinity
      const bv = domainScore(b, sortKey as DomainKey, taskMap) ?? -Infinity
      return mul * (av - bv)
    })
  }, [run.results, search, sortKey, sortDir, taskMap])

  function Th({ label, col }: { label: string; col: CapSortKey }) {
    return (
      <th
        className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wide cursor-pointer select-none hover:text-zinc-200"
        onClick={() => handleSort(col)}
      >
        {label}<SortIcon active={sortKey === col} dir={sortDir} />
      </th>
    )
  }

  return (
    <>
      <FilterBar search={search} onSearch={setSearch} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-zinc-800">
              <th
                className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wide cursor-pointer select-none hover:text-zinc-200"
                onClick={() => handleSort('model')}
              >
                Model<SortIcon active={sortKey === 'model'} dir={sortDir} />
              </th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wide">TTFT</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wide">tok/s</th>
              {TASK_DOMAINS.map(d => <Th key={d.key} label={d.label} col={d.key} />)}
              <Th label="Avg" col="avg" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-zinc-500 text-xs py-6">No results match filter</td></tr>
            )}
            {rows.map(model => {
              const perf = perfByModel.get(model)
              const avg  = avgScore(model, taskMap)
              const prevAvg = prevTaskMap ? avgScore(model, prevTaskMap) : null
              return (
                <tr key={model} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/50 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-xs text-zinc-300 truncate max-w-[22ch]">{model}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-right text-zinc-400">{perf?.ttft_ms != null ? `${perf.ttft_ms}ms` : '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-right text-zinc-400">{perf?.tokens_per_sec != null ? perf.tokens_per_sec.toFixed(1) : '—'}</td>
                  {TASK_DOMAINS.map(d => {
                    const score     = domainScore(model, d.key, taskMap)
                    const prevScore = prevTaskMap ? domainScore(model, d.key, prevTaskMap) : null
                    const details   = Object.entries(taskMap[model] ?? {})
                      .filter(([k]) => k.startsWith(d.key))
                      .map(([k, r]) => `${k}: ${r.skipped ? 'skipped' : (r.score?.toFixed(1) ?? '?')}${r.reasoning ? ` — ${r.reasoning.slice(0, 100)}` : ''}`)
                      .join('\n')
                    return (
                      <td key={d.key} className="px-3 py-2.5 text-xs text-right">
                        {score != null ? (
                          <Tooltip>
                            <TooltipTrigger>
                              <span className={`font-semibold ${scoreCls(score)}`}>
                                {score.toFixed(1)}<DeltaBadge current={score} previous={prevScore} />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs whitespace-pre-wrap text-left text-[11px]">
                              {details || 'No details'}
                            </TooltipContent>
                          </Tooltip>
                        ) : <span className="text-zinc-600">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 text-xs text-right font-bold">
                    {avg != null
                      ? <span className={scoreCls(avg)}>{avg.toFixed(1)}<DeltaBadge current={avg} previous={prevAvg} /></span>
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Run dialog
// ---------------------------------------------------------------------------
function RunDialog({
  open, onOpenChange, onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onConfirm: (tier: Tier, scope: Scope) => void
}) {
  const [tier, setTier]   = useState<Tier>('short')
  const [scope, setScope] = useState<Scope>('local')

  const tierDesc: Record<Tier, string> = {
    short: 'Fires a single streaming request per model and measures TTFT and throughput. Takes ~30–60s.',
    full:  'Tests reasoning, instruction following, coding, drafting, and tool-calling with an LLM judge. Takes 5–15 minutes.',
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Run Benchmark</AlertDialogTitle>
          <AlertDialogDescription>{tierDesc[tier]}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Tier</p>
          <div className="flex gap-2">
            {(['short', 'full'] as Tier[]).map(t => (
              <button key={t} onClick={() => setTier(t)}
                className={`flex-1 px-3 py-2 rounded text-sm font-medium border transition-colors capitalize
                  ${tier === t ? 'bg-zinc-700 border-zinc-500 text-zinc-100' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Scope</p>
          <div className="flex gap-2">
            {(Object.entries(SCOPE_LABELS) as [Scope, string][]).map(([s, label]) => (
              <button key={s} onClick={() => setScope(s)}
                className={`flex-1 px-3 py-2 rounded text-sm font-medium border transition-colors
                  ${scope === s ? 'bg-zinc-700 border-zinc-500 text-zinc-100' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(tier, scope)}>
            Run {tier} · {SCOPE_LABELS[scope]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function BenchmarkRunner() {
  const [latestShort, setLatestShort] = useState<BenchmarkRun | null>(null)
  const [latestFull, setLatestFull]   = useState<BenchmarkRun | null>(null)
  const [history, setHistory]         = useState<BenchmarkRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [status, setStatus]           = useState<BenchmarkStatus>({ running: false, tier: null, run_id: null, started_at: null })
  const [taskResults, setTaskResults] = useState<Record<string, BenchmarkTaskResultsMap>>({})
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState<Tier>('short')
  const [dialogOpen, setDialogOpen]   = useState(false)
  const prevStatusRef = useRef<BenchmarkStatus>(status)

  const fetchLatest = useCallback(async () => {
    try {
      const [rs, rf] = await Promise.all([
        fetch(`${SIDECAR_URL}/api/benchmark/latest?tier=short`).then(r => r.json()),
        fetch(`${SIDECAR_URL}/api/benchmark/latest?tier=full`).then(r => r.json()),
      ])
      if (rs.run) setLatestShort(rs.run)
      if (rf.run) setLatestFull(rf.run)
    } catch { /* ignore */ }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(`${SIDECAR_URL}/api/benchmark/history?limit=20`)
      const d = await r.json()
      setHistory(d.runs ?? [])
    } catch { /* ignore */ }
  }, [])

  const fetchTaskResults = useCallback(async (runId: string) => {
    if (taskResults[runId]) return
    try {
      const r = await fetch(`${SIDECAR_URL}/api/benchmark/task-results/${runId}`)
      const d = await r.json()
      setTaskResults(prev => ({ ...prev, [runId]: d.results ?? {} }))
    } catch { /* ignore */ }
  }, [taskResults])

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${SIDECAR_URL}/api/benchmark/status`)
        const s: BenchmarkStatus = await r.json()
        setStatus(s)
        if (prevStatusRef.current.running && !s.running) {
          fetchLatest()
          fetchHistory()
        }
        prevStatusRef.current = s
      } catch { /* ignore */ }
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => clearInterval(timer)
  }, [fetchLatest, fetchHistory])

  useEffect(() => { fetchLatest(); fetchHistory() }, [fetchLatest, fetchHistory])

  const displayRun = selectedRunId
    ? history.find(r => r.run_id === selectedRunId) ?? null
    : activeTab === 'short' ? latestShort : latestFull

  useEffect(() => {
    if (displayRun?.tier === 'full' && displayRun.completed_at) {
      fetchTaskResults(displayRun.run_id)
    }
  }, [displayRun, fetchTaskResults])

  const prevRun = useMemo(() => {
    if (!displayRun) return null
    return history.find(h => h.tier === displayRun.tier && h.run_id !== displayRun.run_id) ?? null
  }, [displayRun, history])

  const handleConfirmRun = async (tier: Tier, scope: Scope) => {
    setDialogOpen(false)
    setError(null)
    try {
      const r = await fetch(`${SIDECAR_URL}/api/benchmark/run?tier=${tier}&scope=${scope}`, { method: 'POST' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error((d as { detail?: string }).detail ?? `HTTP ${r.status}`)
      }
      setActiveTab(tier)
      setSelectedRunId(null)
    } catch (e) {
      setError(`Failed to start benchmark: ${(e as Error).message}`)
    }
  }

  const handleRefreshModels = async () => {
    setRefreshingModels(true)
    setError(null)
    try {
      const r = await fetch(`${SIDECAR_URL}/api/models/refresh`, { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      setError(`Model refresh failed: ${(e as Error).message}`)
    } finally {
      setRefreshingModels(false)
    }
  }

  const isRunning = status.running

  return (
    <Card className="bg-zinc-900 border-white/10">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Benchmark Runner</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefreshModels}
              disabled={refreshingModels} className="gap-1.5 text-xs">
              <RefreshCw className={`size-3 ${refreshingModels ? 'animate-spin' : ''}`} />
              {refreshingModels ? 'Refreshing…' : 'Refresh Models'}
            </Button>
            <Button size="sm" disabled={isRunning} onClick={() => setDialogOpen(true)} className="text-xs">
              {isRunning ? 'Running…' : 'Run Benchmark'}
            </Button>
          </div>
        </div>

        {isRunning && (
          <div className="mt-3">
            <div className="flex items-center gap-2 text-xs text-zinc-400 mb-1.5">
              <RefreshCw className="size-3 animate-spin" />
              <span>
                Running {status.tier ?? ''} benchmark
                {status.started_at && ` · ${Math.floor((Date.now() - new Date(status.started_at).getTime()) / 1000)}s`}
              </span>
            </div>
            <div className="h-0.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full w-1/3 bg-zinc-400 rounded-full"
                style={{ animation: 'bslide 1.4s ease-in-out infinite' }} />
            </div>
            <style>{`@keyframes bslide{0%{transform:translateX(-100%) scaleX(1)}50%{transform:translateX(150%) scaleX(1.5)}100%{transform:translateX(400%) scaleX(1)}}`}</style>
          </div>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {!selectedRunId && (
          <div className="flex gap-1 border-b border-zinc-800">
            {(['short', 'full'] as Tier[]).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize
                  ${activeTab === t ? 'border-zinc-300 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                {t}
              </button>
            ))}
          </div>
        )}

        {selectedRunId && (
          <button className="text-sm text-zinc-400 hover:text-zinc-200 self-start" onClick={() => setSelectedRunId(null)}>
            ← Back to latest
          </button>
        )}

        {displayRun ? (
          <div>
            <div className="flex items-center gap-2 mb-3 text-xs text-zinc-500">
              <span>Run {displayRun.run_id.slice(0, 8)}</span>
              <span>·</span>
              <Tooltip>
                <TooltipTrigger><span>{fmtRelative(displayRun.started_at)}</span></TooltipTrigger>
                <TooltipContent>{displayRun.started_at}</TooltipContent>
              </Tooltip>
              <Badge className="ml-1 text-[10px] px-1.5 py-0 bg-zinc-800 text-zinc-400 border-zinc-700 capitalize">
                {displayRun.tier}
              </Badge>
              {!displayRun.completed_at && <span className="text-amber-400">· in progress</span>}
            </div>

            {displayRun.tier === 'short' ? (
              <PerfTable run={displayRun} prevRun={prevRun} />
            ) : taskResults[displayRun.run_id] ? (
              <CapabilityTable
                run={displayRun}
                taskMap={taskResults[displayRun.run_id]}
                prevTaskMap={prevRun ? (taskResults[prevRun.run_id] ?? null) : null}
              />
            ) : (
              <p className="py-4 text-center text-sm text-zinc-500">
                {displayRun.completed_at ? 'Loading capability results…' : 'Waiting for run to complete…'}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-sm font-medium text-zinc-400">No {activeTab} benchmark results yet</p>
            <p className="text-xs text-zinc-500 mt-1">Click "Run Benchmark" to start the first run.</p>
          </div>
        )}

        <Separator />

        <div>
          <h3 className="text-sm font-semibold mb-2">History</h3>
          {history.length === 0 ? (
            <p className="text-xs text-zinc-500">No benchmark history</p>
          ) : history.map((run, idx) => (
            <button key={run.run_id}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm hover:bg-zinc-800 transition-colors text-left
                ${selectedRunId === run.run_id ? 'bg-zinc-800' : ''}`}
              onClick={() => {
                if (selectedRunId === run.run_id) { setSelectedRunId(null); return }
                setSelectedRunId(run.run_id)
                if (run.tier === 'full' && run.completed_at) fetchTaskResults(run.run_id)
              }}
            >
              <span className="text-zinc-300 flex-1">Run #{history.length - idx}</span>
              <Badge className="text-[10px] px-1.5 py-0 bg-zinc-800 text-zinc-400 border-zinc-700 capitalize">{run.tier}</Badge>
              <Tooltip>
                <TooltipTrigger><span className="text-zinc-500 text-xs">{fmtRelative(run.started_at)}</span></TooltipTrigger>
                <TooltipContent>{run.started_at}</TooltipContent>
              </Tooltip>
              <span className={run.completed_at ? 'text-green-400 text-xs' : 'text-amber-400 text-xs'}>
                {run.completed_at ? 'done' : 'running'}
              </span>
            </button>
          ))}
        </div>
      </CardContent>

      <RunDialog open={dialogOpen} onOpenChange={setDialogOpen} onConfirm={handleConfirmRun} />
    </Card>
  )
}
