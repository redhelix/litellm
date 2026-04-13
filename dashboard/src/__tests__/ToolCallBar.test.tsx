import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolCallBar } from '@/components/ToolCallBar'

describe('ToolCallBar', () => {
  it('B1: Renders three segments with correct widths and colour classes', () => {
    const { container } = render(
      <ToolCallBar success={0.82} repaired={0.12} failed={0.06} />
    )
    const segments = container.querySelectorAll('[data-segment]')
    expect(segments).toHaveLength(3)

    const [success, repaired, failed] = segments
    expect(success.getAttribute('style')).toContain('width: 82%')
    expect(success.classList.contains('bg-green-500')).toBe(true)
    expect(repaired.getAttribute('style')).toContain('width: 12%')
    expect(repaired.classList.contains('bg-amber-500')).toBe(true)
    expect(failed.getAttribute('style')).toContain('width: 6%')
    expect(failed.classList.contains('bg-red-500')).toBe(true)
  })

  it('B2: Null values render a zinc-800 no-data bar', () => {
    const { container } = render(
      <ToolCallBar success={null} repaired={null} failed={null} />
    )
    const noData = container.querySelector('[data-no-data]')
    expect(noData).toBeTruthy()
    expect(noData!.classList.contains('bg-zinc-800')).toBe(true)
  })

  it('B3: Segment widths always sum to 100% (normalise)', () => {
    // Inputs sum to 0.9 not 1.0
    const { container } = render(
      <ToolCallBar success={0.45} repaired={0.27} failed={0.18} />
    )
    const segments = container.querySelectorAll('[data-segment]')
    expect(segments).toHaveLength(3)

    let totalWidth = 0
    segments.forEach((seg) => {
      const style = seg.getAttribute('style') ?? ''
      const match = style.match(/width:\s*([\d.]+)%/)
      if (match) totalWidth += parseFloat(match[1])
    })
    expect(Math.round(totalWidth)).toBe(100)
  })

  it('B4: Each segment has accessible aria-label with count%', () => {
    render(<ToolCallBar success={0.82} repaired={0.12} failed={0.06} />)
    expect(screen.getByTitle('success 82%')).toBeTruthy()
    expect(screen.getByTitle('repaired 12%')).toBeTruthy()
    expect(screen.getByTitle('failed 6%')).toBeTruthy()
  })
})
