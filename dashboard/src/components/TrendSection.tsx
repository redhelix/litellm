import { useState } from 'react'
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useTrends } from '@/hooks/useTrends'
import { Card, CardHeader, CardContent } from '@/components/ui/card'

interface TrendSectionProps {
  sidecarUrl?: string
  models: string[]
}

export function TrendSection({ sidecarUrl = '', models }: TrendSectionProps) {
  const [window, setWindow] = useState<'7d' | '30d'>('7d')

  const { results } = useTrends({ sidecarUrl, models, window })

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h2 className="text-lg font-semibold" id="trends-heading">Trends</h2>
        <div className="flex rounded-lg overflow-hidden border border-zinc-700" role="group" aria-label="Trend time range">
          {(['7d', '30d'] as const).map(w => (
            <button
              key={w}
              type="button"
              aria-label={w}
              onClick={() => setWindow(w)}
              className={`text-xs h-7 px-3 transition-colors ${
                window === w
                  ? 'bg-zinc-700 text-zinc-50'
                  : 'bg-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {models.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 p-8 text-center">
            <p className="text-sm font-medium text-zinc-300">No trend data</p>
            <p className="text-xs text-zinc-500 mt-1">
              Trend data will appear once models have processed requests.
            </p>
          </div>
        ) : (
          <>
            <div className="flex gap-4 text-xs text-zinc-400 mb-2">
              <span><span className="inline-block w-3 h-0.5 bg-blue-500 mr-1" />latency p95</span>
              <span><span className="inline-block w-3 h-0.5 bg-amber-500 mr-1" />ctx utilization</span>
              <span><span className="inline-block w-3 h-0.5 bg-red-500 mr-1" />error/repair rate</span>
            </div>
            {models.map(model => {
              const result = results[model]
              return (
                <div key={model} className="flex items-center gap-4 border-b border-zinc-800 py-2">
                  <span className="font-mono text-xs text-zinc-400 w-[20%] truncate">{model}</span>
                  <div
                    className="flex-1"
                    aria-label={`${model} trend chart`}
                  >
                    {result?.loading && <div className="h-16 animate-pulse bg-zinc-800 rounded" />}
                    {result?.error && <span className="text-xs text-red-400">{result.error}</span>}
                    {result?.data && (
                      <ResponsiveContainer width="100%" height={64}>
                        <LineChart data={result.data.series}>
                          <XAxis dataKey="day" hide />
                          <YAxis hide />
                          <Tooltip
                            contentStyle={{
                              background: 'oklch(0.205 0 0)',
                              border: '1px solid oklch(1 0 0 / 10%)',
                              color: 'oklch(0.985 0 0)',
                              fontSize: 12,
                            }}
                          />
                          <Line dataKey="latency_p95" stroke="#3b82f6" dot={false} strokeWidth={1.5} connectNulls={false} />
                          <Line dataKey="avg_context_utilization" stroke="#f59e0b" dot={false} strokeWidth={1.5} connectNulls={false} />
                          <Line dataKey="error_repair_rate" stroke="#ef4444" dot={false} strokeWidth={1.5} connectNulls={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default TrendSection
