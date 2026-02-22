/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://wingdex.app/"}
 */

import { render } from '@testing-library/react'
import { fireEvent, screen } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseSession = vi.fn()
const mockSignInAnonymous = vi.fn()

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => mockUseSession(),
    signIn: {
      anonymous: () => mockSignInAnonymous(),
      social: vi.fn(),
    },
  },
}))

vi.mock('@/hooks/use-wingdex-data', () => ({
  useWingDexData: () => ({
    photos: [],
    outings: [],
    observations: [],
    dex: [],
  }),
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/fun-names', () => ({
  generateBirdName: () => 'test-bird-name',
  getEmojiAvatarColor: () => '',
}))

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarImage: () => null,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => null,
}))

vi.mock('@phosphor-icons/react', () => ({
  House: () => <span>House</span>,
  List: () => <span>List</span>,
  Bird: () => <span>Bird</span>,
  Gear: () => <span>Gear</span>,
  MapPin: () => <span>MapPin</span>,
  GithubLogo: () => <span>GithubLogo</span>,
  AppleLogo: () => <span>AppleLogo</span>,
  Key: () => <span>Key</span>,
  PlusCircle: () => <span>PlusCircle</span>,
  UserPlus: () => <span>UserPlus</span>,
  ArrowsClockwise: () => <span>ArrowsClockwise</span>,
  ArrowLeft: () => <span>ArrowLeft</span>,
}))

vi.mock('@/components/pages/HomePage', () => ({
  default: () => <div>HomePage</div>,
}))

vi.mock('@/components/pages/OutingsPage', () => ({
  default: () => <div>OutingsPage</div>,
}))

vi.mock('@/components/pages/WingDexPage', () => ({
  default: () => <div>WingDexPage</div>,
}))

vi.mock('@/components/pages/SettingsPage', () => ({
  default: () => <div>SettingsPage</div>,
}))

vi.mock('@/components/flows/AddPhotosFlow', () => ({
  default: () => null,
}))

vi.mock('@/hooks/use-auth-gate', () => ({
  useAuthGate: () => ({
    requireAuth: (cb: () => void) => cb(),
    openSignIn: vi.fn(),
    AuthGateModal: null,
  }),
}))

describe('App auth guard (hosted runtime)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseSession.mockReturnValue({ data: null, isPending: false, refetch: vi.fn() })
    mockSignInAnonymous.mockResolvedValue({ error: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ providers: ['github'] }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows boot shell when no session exists yet (anon bootstrap in progress)', async () => {
    const { default: App } = await import('@/App')
    const { container } = render(<App />)

    // BootShell: blank background while anonymous session bootstraps
    expect(container.querySelector('.bg-background')).toBeInTheDocument()
    expect(screen.queryByText('HomePage')).not.toBeInTheDocument()
  })

  it('shows boot shell while hosted session is pending', async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true, refetch: vi.fn() })

    const { default: App } = await import('@/App')
    const { container } = render(<App />)

    // Boot shell renders as a blank background div
    expect(container.querySelector('.bg-background')).toBeInTheDocument()
    expect(screen.queryByText('HomePage')).not.toBeInTheDocument()
  })

  it('renders app content when hosted session is present', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user-123',
          name: 'octocat',
          image: '',
          email: 'octocat@example.com',
        },
      },
      isPending: false,
      refetch: vi.fn(),
    })

    const { default: App } = await import('@/App')
    render(<App />)

    expect(await screen.findByText('HomePage')).toBeInTheDocument()
  })

  it('renders app content for anonymous session (demo-first)', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'anon-1', name: 'anon', image: '', email: '', isAnonymous: true } },
      isPending: false,
      refetch: vi.fn(),
    })

    const { default: App } = await import('@/App')
    render(<App />)

    // Anonymous users see the app (demo-first UX)
    expect(await screen.findByText('HomePage')).toBeInTheDocument()
    // Log-in link should be visible in the header
    expect(screen.getByText('Log in')).toBeInTheDocument()
  })
})
