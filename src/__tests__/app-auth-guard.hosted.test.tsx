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
  ArrowLeft: () => <span>ArrowLeft</span>,
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
    expect(screen.getByText('Sign in with GitHub')).toBeInTheDocument()
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

  it('navigates to signup view and back', async () => {
    const { default: App } = await import('@/App')
    render(<App />)

    // Start on welcome view
    expect(await screen.findByRole('heading', { name: 'Welcome to WingDex' })).toBeInTheDocument()

    // Click "Continue with passkey" to enter signup view
    fireEvent.click(screen.getByText('Continue with passkey'))

    // Signup view should show
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toBeInTheDocument()
    expect(screen.getByText('Create account')).toBeInTheDocument()
    expect(screen.getByText('Back')).toBeInTheDocument()
    // Sign-in link should be present on signup view too
    expect(screen.getByText('Sign in')).toBeInTheDocument()

    // Click back
    fireEvent.click(screen.getByText('Back'))
    expect(screen.getByRole('heading', { name: 'Welcome to WingDex' })).toBeInTheDocument()
  })

  it('does not unmount login page when session flips to pending mid-signup', async () => {
    const refetch = vi.fn()
    mockUseSession.mockReturnValue({ data: null, isPending: false, refetch })

    const { default: App } = await import('@/App')
    const { rerender } = render(<App />)

    // Verify login page is shown
    expect(await screen.findByRole('heading', { name: 'Welcome to WingDex' })).toBeInTheDocument()

    // Navigate to signup view (simulates user mid-signup)
    fireEvent.click(screen.getByText('Continue with passkey'))
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()

    // Simulate session going pending (e.g. anonymous bootstrap triggered refetch)
    mockUseSession.mockReturnValue({ data: null, isPending: true, refetch })
    rerender(<App />)

    // Signup view should still be visible (not replaced by BootShell)
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.queryByText('HomeContentSkeleton')).not.toBeInTheDocument()
  })

  it('does not show app content for anonymous session during signup', async () => {
    const refetch = vi.fn()
    mockUseSession.mockReturnValue({ data: null, isPending: false, refetch })

    const { default: App } = await import('@/App')
    const { rerender } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Welcome to WingDex' })).toBeInTheDocument()

    // Simulate anonymous session appearing (step 1 of signup flow)
    mockUseSession.mockReturnValue({
      data: { user: { id: 'anon-1', name: '', image: '', email: '', isAnonymous: true } },
      isPending: false,
      refetch,
    })
    rerender(<App />)

    // Should still show login page, not app content
    expect(screen.getByRole('heading', { name: 'Welcome to WingDex' })).toBeInTheDocument()
    expect(screen.queryByText('HomePage')).not.toBeInTheDocument()
  })
})
