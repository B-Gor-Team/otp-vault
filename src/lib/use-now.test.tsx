import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNow } from './use-now.ts'

function Clock(props: { frozen?: number; tickMs?: number }) {
  const now = useNow(props)
  return <output>{now}</output>
}

describe('useNow', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks forward from the current time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    render(<Clock tickMs={1000} />)
    expect(document.querySelector('output')?.textContent).toBe('1700000000000')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(document.querySelector('output')?.textContent).toBe('1700000001000')
  })

  it('stays on a frozen timestamp, including the epoch', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const view = render(<Clock frozen={0} tickMs={1000} />)
    expect(document.querySelector('output')?.textContent).toBe('0')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(document.querySelector('output')?.textContent).toBe('0')
    view.rerender(<Clock frozen={1_700_000_030_000} tickMs={1000} />)
    expect(document.querySelector('output')?.textContent).toBe('1700000030000')
  })
})
