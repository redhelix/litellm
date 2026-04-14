import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IntelligenceTab } from '@/components/IntelligenceTab'

// Mock the useIntelligence hook
vi.mock('@/hooks/useIntelligence')
import { useIntelligence } from '@/hooks/useIntelligence'
const mockUseIntelligence = vi.mocked(useIntelligence)

const emptyData = {
  generated_at: null,
  model_used: null,
  health_summary: null,
  anomalies: [],
  recommendations: [],
  hf_models: [],
}

const populatedData = {
  generated_at: '2026-04-14T10:00:00Z',
  model_used: 'nemotron-cascade-2',
  health_summary: 'All systems nominal.',
  anomalies: [
    { title: 'High latency spike', severity: 'high' as const, description: 'Model X exceeded p95 threshold.' },
  ],
  recommendations: [
    { title: 'Reduce max_tokens', body: 'Setting lower max_tokens may improve throughput.' },
  ],
  hf_models: [
    {
      model_id: 'meta-llama/Llama-3-70B-Instruct',
      hf_url: 'https://huggingface.co/meta-llama/Llama-3-70B-Instruct',
      tags: ['text-generation', 'instruct'],
      likes: 5000,
      last_modified: '2026-03-01T00:00:00Z',
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('IntelligenceTab', () => {
  it('Test 1: renders all 4 empty-state headings when data has no content', () => {
    mockUseIntelligence.mockReturnValue({ data: emptyData, loading: false, error: null })

    render(<IntelligenceTab sidecarUrl="http://localhost:4001" />)

    expect(screen.getByText('No health summary yet')).toBeInTheDocument()
    expect(screen.getByText('No anomalies detected')).toBeInTheDocument()
    expect(screen.getByText('No recommendations')).toBeInTheDocument()
    expect(screen.getByText('No new models found')).toBeInTheDocument()
  })

  it('Test 2: populated data — severity badge, advisory badge, HF link attributes', () => {
    mockUseIntelligence.mockReturnValue({ data: populatedData, loading: false, error: null })

    render(<IntelligenceTab sidecarUrl="http://localhost:4001" />)

    // High severity badge has text-red-400 class
    const highBadge = screen.getByText('high')
    expect(highBadge.className).toContain('text-red-400')

    // Advisory only badge appears
    expect(screen.getByText('Advisory only')).toBeInTheDocument()

    // HF link has correct href and rel
    const hfLink = screen.getByRole('link', { name: 'View on HuggingFace' })
    expect(hfLink).toHaveAttribute('href', 'https://huggingface.co/meta-llama/Llama-3-70B-Instruct')
    expect(hfLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(hfLink).toHaveAttribute('target', '_blank')
  })

  it('Test 3: Q&A — submitting a question shows answer in whitespace-pre-wrap block', async () => {
    mockUseIntelligence.mockReturnValue({ data: emptyData, loading: false, error: null })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'test answer' }),
    }))

    render(<IntelligenceTab sidecarUrl="http://localhost:4001" />)

    const textarea = screen.getByPlaceholderText('Ask about your lab metrics…')
    fireEvent.change(textarea, { target: { value: 'Which model has the highest latency?' } })

    const askButton = screen.getByRole('button', { name: /ask/i })
    fireEvent.click(askButton)

    // Button should show "Asking…" while pending
    expect(screen.getByRole('button', { name: 'Asking…' })).toBeDisabled()

    await waitFor(() => {
      expect(screen.getByText('test answer')).toBeInTheDocument()
    })

    // Answer block has whitespace-pre-wrap class
    const answerBlock = screen.getByText('test answer').closest('div')
    expect(answerBlock?.className).toContain('whitespace-pre-wrap')

    vi.unstubAllGlobals()
  })

  it('Test 4: Q&A error — shows correct error copy in red', async () => {
    mockUseIntelligence.mockReturnValue({ data: emptyData, loading: false, error: null })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    render(<IntelligenceTab sidecarUrl="http://localhost:4001" />)

    const textarea = screen.getByPlaceholderText('Ask about your lab metrics…')
    fireEvent.change(textarea, { target: { value: 'test question' } })
    fireEvent.click(screen.getByRole('button', { name: /ask/i }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'Could not get an answer. The sidecar may be unable to reach the LiteLLM proxy.',
        ),
      ).toBeInTheDocument()
    })

    const errorEl = screen.getByText(
      'Could not get an answer. The sidecar may be unable to reach the LiteLLM proxy.',
    )
    expect(errorEl.className).toContain('text-red-400')

    vi.unstubAllGlobals()
  })
})
