import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallButton } from './InstallButton.tsx'

function setStandalone(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('standalone') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

describe('InstallButton', () => {
  afterEach(() => {
    setStandalone(false)
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (X11; Linux x86_64)',
    })
  })

  it('offers install when the browser raises beforeinstallprompt', async () => {
    setStandalone(false)
    const user = userEvent.setup()
    const prompt = vi.fn().mockResolvedValue(undefined)
    render(<InstallButton />)

    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument()

    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Install app' }))
    expect(prompt).toHaveBeenCalledOnce()
    expect(await screen.findByText('Installed')).toBeInTheDocument()
  })

  it('keeps the button when installation is dismissed', async () => {
    setStandalone(false)
    const user = userEvent.setup()
    render(<InstallButton />)
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    })
    act(() => {
      window.dispatchEvent(event)
    })
    await user.click(screen.getByRole('button', { name: 'Install app' }))
    expect(await screen.findByRole('button', { name: 'Install app' })).toBeInTheDocument()
  })

  it('shows an installed state when the app is already standalone', () => {
    setStandalone(true)
    render(<InstallButton />)
    expect(screen.getByText('Installed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument()
  })

  it('explains Add to Home Screen on iPhone when no install prompt exists', () => {
    setStandalone(false)
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    })
    render(<InstallButton />)
    expect(
      screen.getByText(
        'On iPhone or iPad, open the Share menu and choose Add to Home Screen.',
      ),
    ).toBeInTheDocument()
  })
})
