import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { computeOverview } from '@/lib/aggregate'
import { formatMs, formatTokensPerSec, formatContextPct } from '@/lib/format'
import { ToolCallBar } from '@/components/ToolCallBar'
import type { ModelAggregate } from '@/types/api'

interface OverviewPanelProps {
  models: ModelAggregate[]
  isStale: boolean
}

function avgToolCallRates(models: ModelAggregate[]) {
  const nonNull = models.filter(
    (m) =>
      m.tool_call_rates.success !== null ||
      m.tool_call_rates.repaired !== null ||
      m.tool_call_rates.failed !== null,
  )
  if (nonNull.length === 0) return { success: null, repaired: null, failed: null }

  const sum = nonNull.reduce(
    (acc, m) => ({
      success: acc.success + (m.tool_call_rates.success ?? 0),
      repaired: acc.repaired + (m.tool_call_rates.repaired ?? 0),
      failed: acc.failed + (m.tool_call_rates.failed ?? 0),
    }),
    { success: 0, repaired: 0, failed: 0 },
  )
  const n = nonNull.length
  return {
    success: sum.success / n,
    repaired: sum.repaired / n,
    failed: sum.failed / n,
  }
}

const METRIC_HELP: Record<string, string> = {
  'p50 TTFT': 'p50 TTFT — 50th percentile (median) time to first token; latency before streaming begins for a typical request.',
  'p95 total latency': 'p95 total latency — 95th percentile end-to-end response time; worst-case for 1 in 20 requests.',
  'Tokens/sec': 'Throughput — tokens generated per second, averaged across models.',
  'Context %': "Fraction of the model's context window used by this request's prompt.",
}

export function OverviewPanel({ models, isStale }: OverviewPanelProps) {
  const overview = computeOverview(models)
  const toolRates = avgToolCallRates(models)

  const metrics = [
    {
      label: 'p50 TTFT',
      value: formatMs(overview.ttft_p50),
      ariaLabel: 'Overview p50 TTFT',
    },
    {
      label: 'p95 total latency',
      value: formatMs(overview.total_latency_p95),
      ariaLabel: 'Overview p95 total latency',
    },
    {
      label: 'Tokens/sec',
      value: models.length === 0 ? '—' : formatTokensPerSec(overview.tokens_per_sec),
      ariaLabel: 'Overview Tokens/sec',
    },
    {
      label: 'Context %',
      value: formatContextPct(overview.avg_context_utilization),
      ariaLabel: 'Overview Context %',
      nullValue: overview.avg_context_utilization == null,
    },
  ]

  return (
    <section className={isStale ? 'opacity-50' : ''}>
      <h2 className="text-lg font-semibold mb-4">Overview</h2>
      <div className="flex gap-4 flex-wrap">
        {metrics.map(({ label, value, ariaLabel, nullValue }) => (
          <Card key={label} aria-label={ariaLabel} className="flex-1 min-w-[140px]">
            <CardContent className="pt-4">
              <Tooltip>
                <TooltipTrigger>
                  <p className="text-xs text-zinc-400 cursor-default w-fit">{label}</p>
                </TooltipTrigger>
                <TooltipContent>{METRIC_HELP[label]}</TooltipContent>
              </Tooltip>
              {label === 'Context %' && nullValue ? (
                <Tooltip>
                  <TooltipTrigger>
                    <p
                      data-metric-value
                      className="font-mono text-[28px] font-semibold leading-tight mt-1 cursor-default w-fit"
                    >
                      ?
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>Context window size unknown for this model alias</TooltipContent>
                </Tooltip>
              ) : (
                <p
                  data-metric-value
                  className="font-mono text-[28px] font-semibold leading-tight mt-1"
                >
                  {value}
                </p>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Tool calls card */}
        <Card aria-label="Overview Tool calls" className="flex-1 min-w-[180px]">
          <CardContent className="pt-4">
            <p className="text-xs text-zinc-400">Tool calls</p>
            <div className="mt-3">
              <ToolCallBar
                success={toolRates.success}
                repaired={toolRates.repaired}
                failed={toolRates.failed}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
