import { useState } from 'react'
import { useIntelligence } from '@/hooks/useIntelligence'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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
  const { data, loading, error } = useIntelligence(sidecarUrl)

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

  return (
    <div>
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
            <p className="text-sm text-zinc-300">{data.health_summary}</p>
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
                  <p className="text-sm text-zinc-400">{rec.body}</p>
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
        <h2 id="hf-heading" className="text-lg font-semibold mb-4">
          New Model Suggestions
        </h2>

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
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300 whitespace-pre-wrap font-mono mt-4">
            {qaError ? (
              <span className="text-red-400">{qaError}</span>
            ) : (
              answer
            )}
          </div>
        )}
      </section>

      {/* TODO: wrap in opacity-50 when isStale signal is available (12h cadence makes this lower priority) */}
    </div>
  )
}

export default IntelligenceTab
