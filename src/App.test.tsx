import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App.tsx'

const NOW = 1_699_999_980_000
const REFERENCE_HEX = '05a06f6c6f38fc646dbba4f39aeed9719b98d35e'

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

function renderApp(storage = memoryStorage(), now = NOW) {
  return render(<App now={now} storage={storage} />)
}

describe('Meridian', () => {
  it('explains the empty vault and the pyotp algorithm', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: 'Meridian' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No keys on this device' })).toBeInTheDocument()
    expect(screen.getByText(/pyotp\.TOTP/)).toHaveTextContent('interval=60')
    expect(screen.getByText('SHA-1')).toBeInTheDocument()
    expect(screen.getByText('6 digits')).toBeInTheDocument()
    expect(screen.getByText('60-second step')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Secrets stay in this browser. Meridian never sends them anywhere.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('active-code')).not.toBeInTheDocument()
  })

  it('previews the reference hex key and keeps it in the browser vault', async () => {
    const user = userEvent.setup()
    const storage = memoryStorage()
    const view = renderApp(storage)

    await user.click(screen.getByRole('button', { name: 'Use the reference hex key' }))
    expect(screen.getByRole('textbox', { name: 'Key name' })).toHaveValue('Reference vector')
    expect(screen.getByRole('textbox', { name: 'Secret' })).toHaveValue(REFERENCE_HEX)
    expect(screen.getByTestId('code-preview')).toHaveTextContent('026 209')

    await user.click(screen.getByRole('button', { name: 'Keep on this device' }))

    expect(screen.queryByTestId('code-preview')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-code')).toHaveTextContent('026 209')
    expect(screen.getByTestId('seconds-remaining')).toHaveTextContent('60s')
    const rail = screen.getByRole('list', { name: 'Codes around this minute' })
    expect(rail).toHaveTextContent(/386\s*285/)
    expect(rail).toHaveTextContent(/249\s*559/)
    expect(storage.getItem('meridian.vault.v1')).toContain(
      'AWQG63DPHD6GI3N3UTZZV3WZOGNZRU26',
    )

    view.rerender(<App now={NOW + 30_000} storage={storage} />)
    expect(screen.getByTestId('active-code')).toHaveTextContent('026 209')
    expect(screen.getByTestId('seconds-remaining')).toHaveTextContent('30s')

    view.rerender(<App now={NOW + 60_000} storage={storage} />)
    expect(screen.getByTestId('active-code')).toHaveTextContent('249 559')
    expect(screen.getByTestId('seconds-remaining')).toHaveTextContent('60s')
  })

  it('accepts spaced hex, switches format for base32, and stores a second key', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByRole('textbox', { name: 'Key name' }), 'Lab')
    await user.click(screen.getByRole('button', { name: 'Use the reference hex key' }))
    expect(screen.getByRole('textbox', { name: 'Key name' })).toHaveValue('Lab')

    await user.clear(screen.getByRole('textbox', { name: 'Secret' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Secret' }),
      `0x${REFERENCE_HEX.slice(0, 8)} ${REFERENCE_HEX.slice(8)}`,
    )
    expect(screen.getByTestId('code-preview')).toHaveTextContent('026 209')
    await user.click(screen.getByRole('button', { name: 'Keep on this device' }))

    await user.type(screen.getByRole('textbox', { name: 'Key name' }), 'RFC')
    await user.type(
      screen.getByRole('textbox', { name: 'Secret' }),
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Base32/)

    await user.click(screen.getByRole('radio', { name: 'Base32' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('code-preview')).toHaveTextContent('895 298')
    await user.click(screen.getByRole('button', { name: 'Keep on this device' }))

    expect(screen.getByTestId('active-code')).toHaveTextContent('895 298')
    await user.click(screen.getByRole('button', { name: /Lab/ }))
    expect(screen.getByTestId('active-code')).toHaveTextContent('026 209')
  })

  it('reloads keys from storage, reveals the secret, copies the code, and removes the key', async () => {
    const user = userEvent.setup()
    const storage = memoryStorage()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const first = renderApp(storage)
    await user.click(screen.getByRole('button', { name: 'Use the reference hex key' }))
    await user.click(screen.getByRole('button', { name: 'Keep on this device' }))
    first.unmount()

    renderApp(storage)
    expect(screen.getByTestId('active-code')).toHaveTextContent('026 209')

    await user.click(screen.getByRole('button', { name: 'Show key' }))
    expect(screen.getByTestId('revealed-key')).toHaveTextContent(
      'AWQG63DPHD6GI3N3UTZZV3WZOGNZRU26',
    )
    await user.click(screen.getByRole('button', { name: 'Hide key' }))
    expect(screen.queryByTestId('revealed-key')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(writeText).toHaveBeenCalledWith('026209')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove key' }))
    expect(screen.getByRole('heading', { name: 'Remove Reference vector?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('active-code')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove key' }))
    await user.click(screen.getByRole('button', { name: /^Remove$/ }))
    expect(screen.getByRole('heading', { name: 'No keys on this device' })).toBeInTheDocument()
  })

  it('keeps a key when iPhone Safari has no crypto.randomUUID', async () => {
    const user = userEvent.setup()
    const storage = memoryStorage()
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
    try {
      renderApp(storage)
      await user.click(screen.getByRole('button', { name: 'Use the reference hex key' }))
      await user.click(screen.getByRole('button', { name: 'Keep on this device' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByTestId('active-code')).toHaveTextContent('026 209')
      expect(storage.getItem('meridian.vault.v1')).toContain(
        'AWQG63DPHD6GI3N3UTZZV3WZOGNZRU26',
      )
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID
    }
  })

  it('reports invalid input, duplicates, copy failure, a broken saved key, and blocked storage', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('nope'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const { unmount } = renderApp()
    await user.click(screen.getByRole('button', { name: 'Keep on this device' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a secret.')

    await user.type(screen.getByRole('textbox', { name: 'Secret' }), 'abc')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Hex keys need an even number of digits.',
    )
    expect(screen.queryByTestId('code-preview')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use the reference hex key' }))
    await user.clear(screen.getByRole('textbox', { name: 'Key name' }))
    await user.click(screen.getByRole('button', { name: 'Keep on this device' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Name this key.')

    await user.type(screen.getByRole('textbox', { name: 'Key name' }), 'Lab')
    await user.click(screen.getByRole('button', { name: 'Keep on this device' }))
    await user.click(screen.getByRole('button', { name: 'Use the reference hex key' }))
    await user.click(screen.getByRole('button', { name: 'Keep on this device' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That secret is already on this device.',
    )

    await user.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(await screen.findByText('Could not copy the code.')).toBeInTheDocument()
    unmount()

    const broken = memoryStorage({
      'meridian.vault.v1': JSON.stringify({
        version: 1,
        activeId: 'bad',
        tokens: [
          {
            id: 'bad',
            label: 'Broken',
            secretBase32: '!!!!!!!!',
            createdAt: 1,
          },
        ],
      }),
    })
    const brokenView = renderApp(broken)
    expect(screen.getByRole('heading', { name: 'Broken' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This saved key is unreadable.')
    await user.click(screen.getByRole('button', { name: 'Remove key' }))
    await user.click(screen.getByRole('button', { name: /^Remove$/ }))
    expect(screen.getByRole('heading', { name: 'No keys on this device' })).toBeInTheDocument()
    brokenView.unmount()

    const denied = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    render(<App now={NOW} storage={denied} />)
    await user.click(screen.getByRole('button', { name: 'Use the reference hex key' }))
    await user.click(screen.getByRole('button', { name: 'Keep on this device' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This browser blocked local storage, so the key was not kept.',
    )
    expect(screen.getByTestId('code-preview')).toHaveTextContent('026 209')
  })
})
