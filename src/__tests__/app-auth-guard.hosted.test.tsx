/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://wingdex.app/"}
 */

import { render } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseSession = vi.fn()
const mockSignInAnonymous = vi.fn()

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => mockUseSession(),
    signIn: {
      anonymous: () => mockSignInAnonymous(),
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

vi.mock('@/components/flows/PasskeyAuthDialog', () => ({
  default: () => null,
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
  Key: () => <span>Key</span>,
  PlusCircle: () => <span>PlusCircle</span>,
  UserPlus: () => <span>UserPlus</span>,
  ArrowsClockwise: () => <span>ArrowsClockwise</span>,
}))

vi.mock('@/components/pages/HomePage', () => ({
  default: () => <div>HomePage</div>,
  HomeContentSkeleton: () => <div>HomeContentSkeleton</div>,
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

describe('App auth guard (hosted runtime)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseSession.mockReturnValue({ data: null, isPending: false, refetch: vi.fn() })
    mockSignInAnonymous.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows login page when no hosted session exists', async () => {
    const { default: App } = await import('@/App')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Welcome to WingDex' })).toBeInTheDocument()
    expect(screen.getByText('Continue with passkey')).toBeInTheDocument()
    expect(screen.getByText('Sign in')).toBeInTheDocument()
  })

  it('shows boot shell while hosted session is pending', async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true, refetch: vi.fn() })

    const { default: App } = await import('@/App')
    render(<App />)

    expect(await screen.findByText('HomeContentSkeleton')).toBeInTheDocument()
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
    expect(screen.queryByText('Continue with passkey')).not.toBeInTheDocument()
  })
})
