import './index.css'
import { useDashboardData } from '@/hooks/useDashboardData'
import { RefreshRing } from '@/components/RefreshRing'
import { OverviewPanel } from '@/components/OverviewPanel'
import { ModelCard } from '@/components/ModelCard'
import { NodeGrid } from '@/components/NodeGrid'
import { Separator } from '@/components/ui/separator'

const SIDECAR_URL = (import.meta.env.VITE_SIDECAR_URL as string) ?? 'http://docker-001:4001'

function App() {
  const { models, nodes, error, countdown, isStale } = useDashboardData(SIDECAR_URL)

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-50 px-8 py-12">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-bold tracking-tight">Lab Dashboard</h1>
        <RefreshRing countdown={countdown} error={error} isStale={isStale} />
      </header>

      <OverviewPanel models={models} isStale={isStale} />

      <Separator className="my-8 border-zinc-800" />

      {/* Section 2: Per-model cards */}
      <section aria-label="Models">
        <h2 className="text-lg font-semibold mb-4">Models</h2>
        {models.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 p-8 text-center">
            <p className="text-sm font-medium text-zinc-300">No model data</p>
            <p className="text-xs text-zinc-500 mt-1">
              The sidecar returned no model metrics. Check that dashboard-sidecar is running on
              docker-001:4001.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {models.map((model) => (
              <ModelCard key={model.model} model={model} isStale={isStale} />
            ))}
          </div>
        )}
      </section>

      <Separator className="my-8 border-zinc-800" />

      {/* Section 3: Node health grid */}
      <NodeGrid nodes={nodes} isStale={isStale} />
    </div>
  )
}

export default App
