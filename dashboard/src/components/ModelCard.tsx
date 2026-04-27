import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ToolCallBar } from '@/components/ToolCallBar'
import { formatMs, formatTokensPerSec, formatContextPct } from '@/lib/format'
import type { ModelAggregate, ModelInfo } from '@/types/api'
import { extractSize, extractQuant, isHfPath, hfUrl, resolveServer, resolveRuntime, resolveUrlPort } from '@/utils/modelMeta'

interface ModelCardProps {
  model: ModelAggregate
  isStale: boolean
  modelInfo?: ModelInfo
  healthStatus?: 'up' | 'down' | 'unknown'
}

interface MetricItem {
  label: string
  value: string
  tooltip: string
}

export function ModelCard({ model, isStale, modelInfo, healthStatus }: ModelCardProps) {
  const ctxNull = model.avg_context_utilization == null

  const metrics: MetricItem[] = [
    {
      label: 'p50 TTFT',
      value: formatMs(model.ttft_p50),
      tooltip: 'p50 TTFT — 50th percentile time to first token; latency before streaming begins.',
    },
    {
      label: 'p95 TTFT',
      value: formatMs(model.ttft_p95),
      tooltip: 'p95 TTFT — 95th percentile time to first token; worst-case for 1 in 20 requests.',
    },
    {
      label: 'p50 latency',
      value: formatMs(model.total_latency_p50),
      tooltip: 'p50 total latency — 50th percentile end-to-end response time (median request).',
    },
    {
      label: 'p95 latency',
      value: formatMs(model.total_latency_p95),
      tooltip: 'p95 total latency — 95th percentile end-to-end response time; worst-case for 1 in 20.',
    },
    {
      label: 'tok/s',
      value: formatTokensPerSec(model.tokens_per_sec),
      tooltip: 'Tokens per second — generation throughput for this model.',
    },
    {
      label: 'ctx %',
      value: ctxNull ? '?' : formatContextPct(model.avg_context_utilization),
      tooltip: ctxNull
        ? 'Context window size unknown for this model alias'
        : "Context utilization — fraction of this model's context window used by the prompt.",
    },
  ]

  const contextPct = Math.round((model.avg_context_utilization ?? 0) * 100)

  const backendModel = modelInfo?.backend_model ?? null
  const apiBase = modelInfo?.api_base ?? null
  const provider = modelInfo?.provider ?? ''

  const size = backendModel ? extractSize(backendModel) : null
  const quant = backendModel ? extractQuant(backendModel) : null
  const hasHfLink = backendModel ? isHfPath(backendModel) : false
  const hfLink = hasHfLink && backendModel ? hfUrl(backendModel) : null
  const serverName = resolveServer(apiBase)
  const runtime = resolveRuntime(provider, apiBase)
  const urlPort = resolveUrlPort(apiBase)

  return (
    <Card
      aria-label={`Model ${model.model}`}
      className={isStale ? 'opacity-50' : ''}
    >
      <CardHeader className="pb-2">
        <CardTitle className="font-mono text-sm font-semibold truncate">
          {model.model}
        </CardTitle>

        {/* Backend model row */}
        {backendModel && (
          <p className="text-[11px] text-zinc-500 font-mono truncate mt-0.5">
            {hasHfLink && hfLink ? (
              <a href={hfLink} target="_blank" rel="noopener noreferrer"
                 className="text-blue-400 hover:text-blue-300 underline">
                {backendModel}
              </a>
            ) : backendModel}
          </p>
        )}

        {/* Server meta row: only rendered when modelInfo is available */}
        {modelInfo && (
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              aria-label={`connectivity ${healthStatus ?? 'unknown'}`}
              className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                healthStatus === 'up'   ? 'bg-green-400' :
                healthStatus === 'down' ? 'bg-red-400' :
                                         'bg-zinc-500'
              }`}
            />
            <span className="text-[11px] text-zinc-400">{serverName}</span>
            <span className="text-[11px] text-zinc-500">·</span>
            <span className="text-[11px] text-zinc-400">{runtime}</span>
            {urlPort && (
              <>
                <span className="text-[11px] text-zinc-500">·</span>
                <span className="text-[11px] font-mono text-zinc-400">{urlPort}</span>
              </>
            )}
            {size && (
              <>
                <span className="text-[11px] text-zinc-500">·</span>
                <span className="text-[11px] text-zinc-400">{size}</span>
              </>
            )}
            {quant && (
              <>
                <span className="text-[11px] text-zinc-500">·</span>
                <span className="text-[11px] text-zinc-400">{quant}</span>
              </>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Metric grid */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          {metrics.map(({ label, value, tooltip }) => (
            <Tooltip key={label}>
              <TooltipTrigger>
                <div className="cursor-default">
                  <p className="text-[12px] font-normal text-zinc-500 leading-none mb-1">
                    {label}
                  </p>
                  <p
                    data-metric-value
                    className="font-mono text-sm font-semibold text-zinc-50"
                  >
                    {value}
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Context utilization progress */}
        <div>
          <p className="text-[12px] font-normal text-zinc-500 mb-1">
            Context utilization
          </p>
          <Progress
            value={contextPct}
            aria-label="Context utilization"
          />
        </div>

        {/* Tool call bar */}
        <div>
          <p className="text-[12px] font-normal text-zinc-500 mb-1">Tool calls</p>
          <ToolCallBar
            success={model.tool_call_rates.success}
            repaired={model.tool_call_rates.repaired}
            failed={model.tool_call_rates.failed}
          />
        </div>
      </CardContent>
    </Card>
  )
}
