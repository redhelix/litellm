import './index.css'
import { useDashboardData } from '@/hooks/useDashboardData'
import { RefreshRing } from '@/components/RefreshRing'
import { OverviewPanel } from '@/components/OverviewPanel'

const SIDECAR_URL = (import.meta.env.VITE_SIDECAR_URL as string) ?? 'http://docker-001:4001'

function App() {
  const { models, nodes: _nodes, error, countdown, isStale } = useDashboardData(SIDECAR_URL)

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-50 px-8 py-12">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-bold tracking-tight">Lab Dashboard</h1>
        <RefreshRing countdown={countdown} error={error} isStale={isStale} />
      </header>

      <OverviewPanel models={models} isStale={isStale} />

      {/* Plan 03 will replace these placeholders */}
      <section aria-label="Models" className="mt-8">
        <p className="text-zinc-500 text-sm">Model cards coming in Plan 03</p>
      </section>
      <section aria-label="Nodes" className="mt-8">
        <p className="text-zinc-500 text-sm">Node grid coming in Plan 03</p>
      </section>
    </div>
  )
}

export default App
