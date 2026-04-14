import './index.css'
import { useMemo, useState } from 'react'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useModelHealth } from '@/hooks/useModelHealth'
import { RefreshRing } from '@/components/RefreshRing'
import { OverviewPanel } from '@/components/OverviewPanel'
import { ModelCard } from '@/components/ModelCard'
import { NodeGrid } from '@/components/NodeGrid'
import { Separator } from '@/components/ui/separator'
import { RequestLogTable } from '@/components/RequestLogTable'
import { TrendSection } from '@/components/TrendSection'
import ConfigDriftView from './components/ConfigDriftView'
import BenchmarkRunner from './components/BenchmarkRunner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { resolveServer } from '@/utils/modelMeta'

const SIDECAR_URL = (import.meta.env.VITE_SIDECAR_URL as string) ?? 'http://docker-001:4001'

type ModelFilter = 'All' | 'Local' | 'Cloud'

function App() {
  const { models, nodes, modelInfoMap, error, countdown, isStale } = useDashboardData(SIDECAR_URL)
  const modelNames = useMemo(() => models.map(m => m.model), [models])
  const [modelFilter, setModelFilter] = useState<ModelFilter>('All')

  const { health } = useModelHealth({ sidecarUrl: SIDECAR_URL })

  const filteredModels = useMemo(() => {
    if (modelFilter === 'All') return models
    return models.filter((m) => {
      const info = modelInfoMap[m.model]
      const server = resolveServer(info?.api_base ?? null)
      return modelFilter === 'Cloud' ? server === 'cloud' : server !== 'cloud'
    })
  }, [models, modelInfoMap, modelFilter])

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-50 px-8 py-12">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-bold tracking-tight">Lab Dashboard</h1>
        <RefreshRing countdown={countdown} error={error} isStale={isStale} />
      </header>

      <OverviewPanel models={models} isStale={isStale} sidecarUrl={SIDECAR_URL} />

      <Separator className="my-8 border-zinc-800" />

      {/* Section 2: Per-model cards */}
      <section aria-label="Models">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Models</h2>
          <ToggleGroup
            value={[modelFilter]}
            onValueChange={(vals) => {
              if (vals.length > 0) setModelFilter(vals[0] as ModelFilter)
            }}
            aria-label="Filter models by location"
          >
            <ToggleGroupItem value="All" aria-label="Show all models">All</ToggleGroupItem>
            <ToggleGroupItem value="Local" aria-label="Show local models only">Local</ToggleGroupItem>
            <ToggleGroupItem value="Cloud" aria-label="Show cloud models only">Cloud</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {filteredModels.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 p-8 text-center">
            <p className="text-sm font-medium text-zinc-300">No model data</p>
            <p className="text-xs text-zinc-500 mt-1">
              {models.length === 0
                ? 'The sidecar returned no model metrics. Check that dashboard-sidecar is running on docker-001:4001.'
                : `No ${modelFilter.toLowerCase()} models found.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredModels.map((model) => (
              <ModelCard
                key={model.model}
                model={model}
                isStale={isStale}
                modelInfo={modelInfoMap[model.model]}
                healthStatus={health[model.model]}
              />
            ))}
          </div>
        )}
      </section>

      <Separator className="my-8 border-zinc-800" />

      {/* Section 3: Node health grid */}
      <NodeGrid nodes={nodes} isStale={isStale} />

      <Separator className="my-8 border-zinc-800" />

      <section id="request-log" aria-labelledby="request-log-heading">
        <RequestLogTable sidecarUrl={SIDECAR_URL} modelOptions={modelNames} />
      </section>

      <Separator className="my-8 border-zinc-800" />

      <section aria-labelledby="trends-heading">
        <TrendSection sidecarUrl={SIDECAR_URL} models={modelNames} />
      </section>

      <div className="my-8 border-t border-white/10" />
      <ConfigDriftView />
      <div className="my-8 border-t border-white/10" />
      <BenchmarkRunner />
    </div>
  )
}

export default App
