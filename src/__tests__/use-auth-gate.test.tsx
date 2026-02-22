/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import type React from 'react'
import { useAuthGate } from '@/hooks/use-auth-gate'

const mockSignInPasskey = vi.fn()
const mockGetSession = vi.fn()
const mockAddPasskey = vi.fn()
const mockSignOut = vi.fn()

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: {
      passkey: (...args: unknown[]) => mockSignInPasskey(...args),
      social: vi.fn(),
    },
    getSession: (...args: unknown[]) => mockGetSession(...args),
    passkey: {
      addPasskey: (...args: unknown[]) => mockAddPasskey(...args),
    },
    signOut: (...args: unknown[]) => mockSignOut(...args),
  },
}))

vi.mock('@/lib/fun-names', () => ({
  generateBirdName: () => 'test-bird',
  getEmojiAvatarColor: () => '',
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@phosphor-icons/react', () => ({
  Key: () => <span>Key</span>,
  GithubLogo: () => <span>GitHub</span>,
  AppleLogo: () => <span>Apple</span>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: { checked: boolean; onCheckedChange: (v: boolean) => void } & Record<string, unknown>) => (
    <button role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props}>
      {checked ? 'On' : 'Off'}
    </button>
  ),
}))

function Harness({ onUpgraded, isAnonymous = true }: { onUpgraded: () => void | Promise<void>; isAnonymous?: boolean }) {
  const [actionRan, setActionRan] = useState(false)
  const { requireAuth, AuthGateModal } = useAuthGate({
    isAnonymous,
    onUpgraded,
  })

  return (
    <>
      <button onClick={() => requireAuth(() => setActionRan(true))}>Open gated action</button>
      {AuthGateModal}
      {actionRan && <div>action-ran</div>}
    </>
  )
}

describe('useAuthGate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockSignInPasskey.mockReset()
    mockGetSession.mockReset()
    mockAddPasskey.mockReset()
    mockSignOut.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [] }) }))
    mockSignOut.mockResolvedValue({ error: null })
    mockAddPasskey.mockResolvedValue({ error: null })
  })

  it('opens in sign-up mode and creates account with passkey', async () => {
    mockAddPasskey.mockResolvedValue({ error: null })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ providers: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const onUpgraded = vi.fn()
    render(<Harness onUpgraded={onUpgraded} />)

    await userEvent.click(screen.getByText('Open gated action'))
    expect(screen.getByRole('heading', { name: /sign up/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /sign up with a passkey/i }))

    await waitFor(() => {
      expect(onUpgraded).toHaveBeenCalledTimes(1)
      expect(screen.getByText('action-ran')).toBeInTheDocument()
    })

    expect(mockAddPasskey).toHaveBeenCalledTimes(1)
  })

  it('switches to log-in mode and uses passkey sign-in', async () => {
    mockSignInPasskey.mockResolvedValue({ error: null })
    mockGetSession.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          isAnonymous: false,
        },
      },
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [] }) }))

    const onUpgraded = vi.fn()
    render(<Harness onUpgraded={onUpgraded} />)

    await userEvent.click(screen.getByText('Open gated action'))
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(screen.getByRole('heading', { name: /^log in$/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /log in with a passkey/i }))

    await waitFor(() => {
      expect(mockSignInPasskey).toHaveBeenCalled()
      expect(onUpgraded).toHaveBeenCalledTimes(1)
    })

    expect(mockAddPasskey).not.toHaveBeenCalled()
  })

  it('runs callback immediately when user is not anonymous', async () => {
    const onUpgraded = vi.fn()
    render(<Harness onUpgraded={onUpgraded} isAnonymous={false} />)

    await userEvent.click(screen.getByText('Open gated action'))

    // Callback runs immediately without opening modal
    expect(screen.getByText('action-ran')).toBeInTheDocument()
    expect(onUpgraded).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: /sign up/i })).not.toBeInTheDocument()
  })

  it('does not call onUpgraded when passkey creation is cancelled', async () => {
    mockAddPasskey.mockResolvedValue({
      error: { code: 'ERROR_CEREMONY_ABORTED', message: 'not allowed by the user agent' },
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [] }) }))

    const onUpgraded = vi.fn()
    render(<Harness onUpgraded={onUpgraded} />)

    await userEvent.click(screen.getByText('Open gated action'))
    await userEvent.click(screen.getByRole('button', { name: /sign up with a passkey/i }))

    await waitFor(() => {
      expect(mockAddPasskey).toHaveBeenCalledTimes(1)
    })

    // Modal stays open, callback never fires
    expect(onUpgraded).not.toHaveBeenCalled()
    expect(screen.queryByText('action-ran')).not.toBeInTheDocument()
  })

  it('shows error when authenticator is already registered', async () => {
    mockAddPasskey.mockResolvedValue({
      error: { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', message: 'Authenticator registered' },
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [] }) }))

    const onUpgraded = vi.fn()
    render(<Harness onUpgraded={onUpgraded} />)

    await userEvent.click(screen.getByText('Open gated action'))
    await userEvent.click(screen.getByRole('button', { name: /sign up with a passkey/i }))

    await waitFor(() => {
      expect(screen.getByText(/already has a passkey/i)).toBeInTheDocument()
    })
    expect(onUpgraded).not.toHaveBeenCalled()
  })
})
