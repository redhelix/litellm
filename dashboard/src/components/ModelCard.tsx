import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ToolCallBar } from '@/components/ToolCallBar'
import { formatMs, formatTokensPerSec, formatContextPct } from '@/lib/format'
import type { ModelAggregate } from '@/types/api'

interface ModelCardProps {
  model: ModelAggregate
  isStale: boolean
}

interface MetricItem {
  label: string
  value: string
  tooltip: string
}

export function ModelCard({ model, isStale }: ModelCardProps) {
  const metrics: MetricItem[] = [
    {
      label: 'p50 TTFT',
      value: formatMs(model.ttft_p50),
      tooltip: `p50 TTFT — ${formatMs(model.ttft_p50)}`,
    },
    {
      label: 'p95 TTFT',
      value: formatMs(model.ttft_p95),
      tooltip: `p95 TTFT — ${formatMs(model.ttft_p95)}`,
    },
    {
      label: 'p50 latency',
      value: formatMs(model.total_latency_p50),
      tooltip: `p50 total latency — ${formatMs(model.total_latency_p50)}`,
    },
    {
      label: 'p95 latency',
      value: formatMs(model.total_latency_p95),
      tooltip: `p95 total latency — ${formatMs(model.total_latency_p95)}`,
    },
    {
      label: 'tok/s',
      value: formatTokensPerSec(model.tokens_per_sec),
      tooltip: `Tokens per second — ${formatTokensPerSec(model.tokens_per_sec)}`,
    },
    {
      label: 'ctx %',
      value: formatContextPct(model.avg_context_utilization),
      tooltip: `Context utilization — ${formatContextPct(model.avg_context_utilization)}`,
    },
  ]

  const contextPct = Math.round((model.avg_context_utilization ?? 0) * 100)

  return (
    <Card
      aria-label={`Model ${model.model}`}
      className={isStale ? 'opacity-50' : ''}
    >
      <CardHeader className="pb-2">
        <CardTitle className="font-mono text-sm font-semibold truncate">
          {model.model}
        </CardTitle>
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
