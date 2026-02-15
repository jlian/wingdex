import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-birddex-data', () => ({
  useBirdDexData: () => ({
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
}))

vi.mock('@/components/pages/HomePage', () => ({
  default: () => <div>HomePage</div>,
}))

vi.mock('@/components/pages/OutingsPage', () => ({
  default: () => <div>OutingsPage</div>,
}))

vi.mock('@/components/pages/BirdDexPage', () => ({
  default: () => <div>BirdDexPage</div>,
}))

vi.mock('@/components/pages/SettingsPage', () => ({
  default: () => <div>SettingsPage</div>,
}))

vi.mock('@/components/flows/AddPhotosFlow', () => ({
  default: () => null,
}))

describe('App auth guard (local runtime)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('allows fallback user outside hosted runtime when Spark user lookup fails', async () => {
    vi.stubGlobal('spark', {
      user: vi.fn().mockRejectedValue(new Error('spark unavailable locally')),
    })

    const { default: App } = await import('@/App')
    render(<App />)

    expect(await screen.findByText('HomePage')).toBeInTheDocument()
    expect(screen.queryByText('Sign-in required')).not.toBeInTheDocument()
  })
})
