import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useIntelligence } from '@/hooks/useIntelligence'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RefreshCw } from 'lucide-react'

// Shared Markdown prose styles for the dark zinc theme
const mdClass =
  'prose prose-sm prose-invert max-w-none ' +
  'prose-p:text-zinc-300 prose-p:my-1 ' +
  'prose-strong:text-zinc-200 prose-strong:font-semibold ' +
  'prose-ul:text-zinc-300 prose-ul:my-1 prose-li:my-0.5 ' +
  'prose-ol:text-zinc-300 prose-ol:my-1 ' +
  'prose-h1:text-zinc-200 prose-h2:text-zinc-200 prose-h3:text-zinc-200 ' +
  'prose-h1:text-base prose-h2:text-sm prose-h3:text-sm ' +
  'prose-table:text-xs prose-th:text-zinc-400 prose-td:text-zinc-300 ' +
  'prose-code:text-zinc-300 prose-code:bg-zinc-800 prose-code:px-1 prose-code:rounded ' +
  'prose-hr:border-zinc-700'

interface IntelligenceTabProps {
  sidecarUrl: string
}

// ---------------------------------------------------------------------------
// RelativeTime helper — mirrors the pattern from RequestLogTable.tsx
// ---------------------------------------------------------------------------
function RelativeTime({ iso }: { iso: string }) {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
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
        <span className="text-xs text-zinc-500 cursor-default">Last updated {rel}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="text-xs font-mono">{iso}</span>
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Severity badge classes (locked per style_lock)
// ---------------------------------------------------------------------------
const severityClass: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-green-500/20 text-green-400 border border-green-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  high: 'bg-red-500/20 text-red-400 border border-red-500/30',
}

const advisoryClass = 'bg-amber-500/20 text-amber-400 border border-amber-500/30'

// ---------------------------------------------------------------------------
// IntelligenceTab
// ---------------------------------------------------------------------------
export function IntelligenceTab({ sidecarUrl }: IntelligenceTabProps) {
  const { data, loading, error, refreshing, elapsedSeconds, refresh } = useIntelligence(sidecarUrl)

  // Q&A state
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [qaError, setQaError] = useState<string | null>(null)

  async function handleAsk() {
    if (!question.trim()) return
    setAsking(true)
    setAnswer(null)
    setQaError(null)
    try {
      const res = await fetch(`${sidecarUrl}/api/intelligence/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { answer: ans } = await res.json()
      setAnswer(ans)
    } catch {
      setQaError(
        'Could not get an answer. The sidecar may be unable to reach the LiteLLM proxy.',
      )
    } finally {
      setAsking(false)
    }
  }

  // Loading skeleton — mirrors RequestLogTable pattern
  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-6 w-32 bg-zinc-800 rounded" />
        <div className="h-24 w-full bg-zinc-800 rounded" />
        <div className="h-6 w-48 bg-zinc-800 rounded" />
        <div className="h-16 w-full bg-zinc-800 rounded" />
      </div>
    )
  }

  // Recommendations with all summary fields populated
  const summaryRecs = data?.recommendations?.filter(
    r => r.use_case && r.current_model && r.suggested_model
  ) ?? []

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Refresh bar                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex-1 mr-4">
          {refreshing && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <RefreshCw className="size-3 animate-spin" />
                <span>Running analysis… {elapsedSeconds}s</span>
              </div>
              <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-zinc-400 rounded-full animate-[progress_2s_ease-in-out_infinite]"
                  style={{ width: '40%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
              </div>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing || loading}
          className="shrink-0 gap-1.5"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Analyzing…' : 'Refresh'}
        </Button>
      </div>

      {/* Indeterminate progress bar — full width, only visible while refreshing */}
      {refreshing && (
        <div className="h-0.5 w-full bg-zinc-800 mb-6 rounded-full overflow-hidden">
          <div className="h-full w-1/3 bg-zinc-400 rounded-full"
            style={{ animation: 'slide 1.4s ease-in-out infinite' }} />
        </div>
      )}

      <style>{`
        @keyframes slide {
          0%   { transform: translateX(-100%) scaleX(1); }
          50%  { transform: translateX(150%) scaleX(1.5); }
          100% { transform: translateX(400%) scaleX(1); }
        }
      `}</style>

      {/* ------------------------------------------------------------------ */}
      {/* 0. Recommendations Summary Table                                     */}
      {/* ------------------------------------------------------------------ */}
      {summaryRecs.length > 0 && (
        <section aria-labelledby="summary-table-heading" className="mb-8">
          <h2 id="summary-table-heading" className="text-lg font-semibold mb-4">
            Recommendations Summary
          </h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wide">Use Case</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wide">Current Model</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wide">Suggested Model</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wide">Target Node</th>
                </tr>
              </thead>
              <tbody>
                {summaryRecs.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/50 transition-colors">
                    <td className="px-4 py-3 text-zinc-300 font-medium">{r.use_case}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{r.current_model}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-200">{r.suggested_model}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{r.node ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 1. Lab Health                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="lab-health-heading">
        <h2 id="lab-health-heading" className="text-lg font-semibold mb-4">
          Lab Health
        </h2>

        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : !data || !data.health_summary ? (
          <div>
            <p className="text-sm font-medium text-zinc-300">No health summary yet</p>
            <p className="text-xs text-zinc-500 mt-1">
              Analysis runs every 12 hours. Check back after the next scheduled run.
            </p>
          </div>
        ) : (
          <div>
            <div className={mdClass}><ReactMarkdown remarkPlugins={[remarkGfm]}>{data.health_summary}</ReactMarkdown></div>
            {data.generated_at && (
              <div className="mt-2">
                <RelativeTime iso={data.generated_at} />
              </div>
            )}
          </div>
        )}
      </section>

      <Separator className="my-8 border-zinc-800" />

      {/* ------------------------------------------------------------------ */}
      {/* 2. Anomalies & Diagnosis                                             */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="anomalies-heading">
        <h2 id="anomalies-heading" className="text-lg font-semibold mb-4">
          Anomalies &amp; Diagnosis
        </h2>

        {!data || data.anomalies.length === 0 ? (
          <div>
            <p className="text-sm font-medium text-zinc-300">No anomalies detected</p>
            <p className="text-xs text-zinc-500 mt-1">
              All models are within normal operating parameters.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {data.anomalies.map((anomaly, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-semibold text-zinc-300">
                      {anomaly.title}
                    </CardTitle>
                    <Badge
                      className={`text-xs px-1.5 py-0.5 rounded ${severityClass[anomaly.severity]}`}
                    >
                      {anomaly.severity}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-zinc-400">{anomaly.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Separator className="my-8 border-zinc-800" />

      {/* ------------------------------------------------------------------ */}
      {/* 3. Recommendations                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="recommendations-heading">
        <h2 id="recommendations-heading" className="text-lg font-semibold mb-4">
          Recommendations
        </h2>

        {!data || data.recommendations.length === 0 ? (
          <div>
            <p className="text-sm font-medium text-zinc-300">No recommendations</p>
            <p className="text-xs text-zinc-500 mt-1">
              Nothing to suggest at this time. Run a benchmark or collect more data.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {data.recommendations.map((rec, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-semibold text-zinc-300">
                      {rec.title}
                    </CardTitle>
                    <Badge className={`text-xs px-1.5 py-0.5 rounded ${advisoryClass}`}>
                      Advisory only
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={mdClass}><ReactMarkdown remarkPlugins={[remarkGfm]}>{rec.body}</ReactMarkdown></div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Separator className="my-8 border-zinc-800" />

      {/* ------------------------------------------------------------------ */}
      {/* 4. New Model Suggestions                                             */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="hf-heading">
        <h2 id="hf-heading" className="text-lg font-semibold mb-1">
          New Model Suggestions
        </h2>
        {data?.hf_search_rationale && (
          <p className="text-xs text-zinc-500 mb-4">{data.hf_search_rationale}</p>
        )}

        {!data || data.hf_models.length === 0 ? (
          <div>
            <p className="text-sm font-medium text-zinc-300">No new models found</p>
            <p className="text-xs text-zinc-500 mt-1">
              HuggingFace search returned no results matching the lab profile. Check again after
              the next 12-hour refresh.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {data.hf_models.map((hfModel, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <CardTitle className="font-mono text-sm font-semibold">
                    {hfModel.model_id}
                  </CardTitle>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {hfModel.tags.join(' · ')}
                  </p>
                </CardHeader>
                <CardContent>
                  <a
                    href={hfModel.hf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline text-sm"
                  >
                    View on HuggingFace
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Separator className="my-8 border-zinc-800" />

      {/* ------------------------------------------------------------------ */}
      {/* 5. Ask a Question                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="qa-heading">
        <h2 id="qa-heading" className="text-lg font-semibold mb-4">
          Ask a Question
        </h2>

        <Textarea
          rows={3}
          placeholder="Ask about your lab metrics…"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          className="mb-3"
        />
        <Button
          variant="outline"
          disabled={asking}
          onClick={handleAsk}
        >
          {asking ? 'Asking…' : 'Ask'}
        </Button>

        {/* Answer block — hidden until first submission */}
        {(answer !== null || qaError !== null) && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 mt-4">
            {qaError ? (
              <span className="text-sm text-red-400">{qaError}</span>
            ) : (
              <div className={mdClass}><ReactMarkdown remarkPlugins={[remarkGfm]}>{answer ?? ''}</ReactMarkdown></div>
            )}
          </div>
        )}
      </section>

      {/* TODO: wrap in opacity-50 when isStale signal is available (12h cadence makes this lower priority) */}
    </div>
  )
}

export default IntelligenceTab
