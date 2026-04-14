import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ConfigDiffResponse, DriftItem } from '../types/api'

const SIDECAR_URL = import.meta.env.VITE_SIDECAR_URL ?? 'http://docker-001:4001'

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function MismatchRow({ item }: { item: DriftItem }) {
  return (
    <li role="listitem" className="flex flex-col gap-0.5 py-2 px-3 min-h-[36px] hover:bg-zinc-800 border-b border-white/10 last:border-0">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-amber-500">△</span>
        <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/40 px-1">MISMATCH</Badge>
        <span className="font-mono text-sm text-zinc-400 truncate max-w-[40ch]">{item.key_path}</span>
      </div>
      <div className="flex gap-2 pl-6 text-xs">
        <span className="text-zinc-500">Deployed:</span>
        <Tooltip>
          <TooltipTrigger>
            <span className="font-mono text-amber-500 truncate max-w-[40ch]">{item.deployed_value || '—'}</span>
          </TooltipTrigger>
          <TooltipContent>{item.deployed_value}</TooltipContent>
        </Tooltip>
        <span className="text-zinc-500">→ Repo:</span>
        <Tooltip>
          <TooltipTrigger>
            <span className="font-mono text-zinc-50 truncate max-w-[40ch]">{item.repo_value || '—'}</span>
          </TooltipTrigger>
          <TooltipContent>{item.repo_value}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  )
}

function MissingRow({ item }: { item: DriftItem }) {
  return (
    <li role="listitem" className="flex items-center gap-2 py-2 px-3 min-h-[36px] hover:bg-zinc-800 border-b border-white/10 last:border-0">
      <span aria-hidden="true" className="text-red-500">✗</span>
      <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40 px-1">MISSING</Badge>
      <span className="font-mono text-sm text-zinc-400">{item.key_path}</span>
      <span className="text-xs text-zinc-500">Not in deployed config</span>
    </li>
  )
}

export default function ConfigDriftView() {
  const [data, setData] = useState<ConfigDiffResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${SIDECAR_URL}/api/config/diff`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [])

  const securityItems = data?.items.filter(i => i.severity === 'security') ?? []
  const mismatchItems = data?.items.filter(i => i.severity === 'mismatch') ?? []
  const missingItems = data?.items.filter(i => i.severity === 'missing') ?? []
  const totalCount = data?.items.length ?? 0

  return (
    <Card className="bg-zinc-900 border-white/10">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h2 className="text-lg font-semibold">Config Drift</h2>
        {data && totalCount > 0 && (
          <span className="text-sm text-zinc-500">{totalCount} differences</span>
        )}
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="animate-pulse h-8 bg-zinc-800 rounded" aria-label="Loading config diff" />
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              Could not load config diff — check that dashboard-sidecar is running on docker-001:4001.
            </AlertDescription>
          </Alert>
        )}
        {data && (
          <>
            {securityItems.map(item => (
              <Alert
                key={item.key_path}
                role="alert"
                className="mb-3 bg-orange-500/10 border-orange-500/30"
              >
                <AlertTitle className="text-orange-400">Security: hardcoded master_key detected</AlertTitle>
                <AlertDescription className="text-orange-300/80">
                  The deployed config.yaml contains a hardcoded master_key. Rotate this key and use an environment variable before production deployment.
                </AlertDescription>
              </Alert>
            ))}

            {(mismatchItems.length > 0 || missingItems.length > 0) && (
              <ul role="list" className="rounded border border-white/10 divide-y divide-white/10">
                {mismatchItems.map(item => <MismatchRow key={item.key_path} item={item} />)}
                {missingItems.map(item => <MissingRow key={item.key_path} item={item} />)}
              </ul>
            )}

            {totalCount === 0 && (
              <p className="text-sm text-zinc-500">No differences detected between deployed and repo configs.</p>
            )}

            {data.last_checked && (
              <Tooltip>
                <TooltipTrigger>
                  <p className="text-xs text-zinc-500 mt-3 cursor-default">
                    Last checked: {formatRelative(data.last_checked)}
                  </p>
                </TooltipTrigger>
                <TooltipContent>{data.last_checked}</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
