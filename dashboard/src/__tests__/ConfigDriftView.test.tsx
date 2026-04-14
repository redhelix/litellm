import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ConfigDriftView from '../components/ConfigDriftView'
import { TooltipProvider } from '@/components/ui/tooltip'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: () => Promise.resolve({
      items: [
        { key_path: 'general_settings.master_key', deployed_value: '[REDACTED]', repo_value: '', severity: 'security' },
        { key_path: 'router_settings.routing_strategy', deployed_value: 'simple-shuffle', repo_value: 'latency-based-routing', severity: 'mismatch' },
        { key_path: 'model_list[claude-3-haiku]', deployed_value: '', repo_value: 'claude-3-haiku', severity: 'missing' },
      ],
      last_checked: new Date().toISOString(),
    })
  }))
})

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>)

describe('ConfigDriftView', () => {
  it('renders section heading "Config Drift"', async () => {
    wrap(<ConfigDriftView />)
    expect(await screen.findByText('Config Drift')).toBeInTheDocument()
  })

  it('renders security Alert for hardcoded master_key (DRIFT-02)', async () => {
    wrap(<ConfigDriftView />)
    expect(await screen.findByText(/Security: hardcoded master_key detected/i)).toBeInTheDocument()
  })

  it('renders MISMATCH label for routing strategy (DRIFT-03)', async () => {
    wrap(<ConfigDriftView />)
    expect(await screen.findByText('MISMATCH')).toBeInTheDocument()
  })

  it('renders MISSING label for absent backend (DRIFT-04)', async () => {
    wrap(<ConfigDriftView />)
    expect(await screen.findByText('MISSING')).toBeInTheDocument()
  })

  it('shows "No differences detected" when items is empty (DRIFT-01)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ items: [], last_checked: new Date().toISOString() })
    }))
    wrap(<ConfigDriftView />)
    expect(await screen.findByText(/No differences detected/i)).toBeInTheDocument()
  })
})
