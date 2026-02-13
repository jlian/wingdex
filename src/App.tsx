import { useState, useEffect, useCallback, useRef } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Toaster } from '@/components/ui/sonner'
import { House, List, Bird, Gear, Plus } from '@phosphor-icons/react'
import { useBirdDexData } from '@/hooks/use-birddex-data'

import HomePage from '@/components/pages/HomePage'
import OutingsPage from '@/components/pages/OutingsPage'
import BirdDexPage from '@/components/pages/BirdDexPage'
import SettingsPage from '@/components/pages/SettingsPage'
import AddPhotosFlow from '@/components/flows/AddPhotosFlow'

interface UserInfo {
  login: string
  avatarUrl: string
  email: string
  id: number
  isOwner: boolean
}

const DEV_USER_ID_KEY = 'birddex_dev_user_id'

function getStableDevUserId(): number {
  try {
    const stored = window.localStorage.getItem(DEV_USER_ID_KEY)
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }

    const seed = `${window.location.hostname}:${window.location.pathname}`
    let hash = 0
    for (let index = 0; index < seed.length; index++) {
      hash = (hash * 31 + seed.charCodeAt(index)) | 0
    }

    const randomPart = Math.floor(Math.random() * 1_000_000)
    const generated = (Math.abs(hash * 31 + randomPart) % 900_000_000) + 100_000_000
    window.localStorage.setItem(DEV_USER_ID_KEY, String(generated))
    return generated
  } catch {
    return Math.floor(Math.random() * 900_000_000) + 100_000_000
  }
}

function getFallbackUser(): UserInfo {
  return {
    login: 'dev-user',
    avatarUrl: '',
    email: 'dev@localhost',
    id: getStableDevUserId(),
    isOwner: true,
  }
}

// ─── URL Hash Router ──────────────────────────────────────

function parseHash(): { tab: string; subId?: string } {
  const hash = window.location.hash.slice(1)
  if (!hash) return { tab: 'home' }
  const [segment, ...rest] = hash.split('/')
  const subId = rest.length > 0 ? decodeURIComponent(rest.join('/')) : undefined
  if (['home', 'outings', 'birddex', 'settings'].includes(segment)) {
    return { tab: segment, subId }
  }
  return { tab: 'home' }
}

function useHashRouter() {
  const [route, setRoute] = useState(parseHash)
  const navigatingWithSubId = useRef(false)

  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])

  // Clear the guard after each render
  useEffect(() => { navigatingWithSubId.current = false })

  const navigate = useCallback((tab: string, subId?: string) => {
    const hash = subId
      ? `#${tab}/${encodeURIComponent(subId)}`
      : tab === 'home' ? '' : `#${tab}`
    window.history.pushState(null, '', hash || window.location.pathname)
    if (subId) navigatingWithSubId.current = true
    setRoute({ tab, subId })
  }, [])

  const handleTabChange = useCallback((val: string) => {
    // Guard: if we just navigated with a subId, don't let onValueChange override it
    if (navigatingWithSubId.current) return
    navigate(val)
  }, [navigate])

  return { tab: route.tab, subId: route.subId, navigate, handleTabChange }
}

// ─── App ──────────────────────────────────────────────────

function App() {
  const [user, setUser] = useState<UserInfo | null>(null)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userInfo = await window.spark.user()
        if (userInfo && typeof userInfo.login === 'string' && typeof userInfo.id === 'number') {
          setUser(userInfo)
        } else {
          console.warn('Spark user API returned invalid data, using fallback:', userInfo)
          setUser(getFallbackUser())
        }
      } catch (error) {
        console.warn('Spark user API unavailable, using fallback:', error)
        setUser(getFallbackUser())
      }
    }
    fetchUser()
  }, [])

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-6 px-4">
          <div className="flex justify-center">
            <Bird size={64} weight="duotone" className="text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="font-serif text-4xl font-semibold text-foreground">
              BirdDex
            </h1>
            <p className="text-muted-foreground text-lg">
              Photo-First Bird Identification
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span>Loading...</span>
          </div>
        </div>
      </div>
    )
  }

  return <AppContent user={user} />
}

function AppContent({ user }: { user: UserInfo }) {
  const { tab, subId, navigate, handleTabChange } = useHashRouter()
  const [showAddPhotos, setShowAddPhotos] = useState(false)
  const data = useBirdDexData(user.id)

  const navItems = [
    { value: 'home', label: 'Home', icon: House },
    { value: 'outings', label: 'Outings', icon: List },
    { value: 'birddex', label: 'BirdDex', icon: Bird },
    { value: 'settings', label: 'Settings', icon: Gear },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />

      <Tabs value={tab} onValueChange={handleTabChange} activationMode="manual">
        {/* ── Top header + desktop nav ──────────────────────── */}
        <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-lg border-b border-border">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between h-14 sm:h-16">
              {/* Logo */}
              <button
                onClick={() => navigate('home')}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                <Bird size={28} weight="duotone" className="text-primary" />
              </button>

              {/* Desktop nav — hidden on mobile */}
              <TabsList className="hidden md:flex bg-transparent gap-1 h-auto p-0">
                {navItems.map(item => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    onClick={() => {
                      // If clicking the already-active tab, clear any subId (e.g. go back to list from detail)
                      if (item.value === tab && subId) navigate(item.value)
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
                      data-[state=active]:bg-primary/10 data-[state=active]:text-primary
                      data-[state=inactive]:text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <item.icon size={18} />
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* Right side: upload + avatar */}
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => setShowAddPhotos(true)}
                  className="flex bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Plus size={16} className="mr-1" weight="bold" />
                  Add Photos
                </Button>
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.avatarUrl} alt={user.login} />
                  <AvatarFallback>{user.login[0].toUpperCase()}</AvatarFallback>
                </Avatar>
              </div>
            </div>
          </div>
        </header>

        {/* ── Main content ────────────────────────────────── */}
        <main className="w-full max-w-5xl mx-auto pb-20 md:pb-8">
          <TabsContent value="home" className="mt-0">
            <HomePage
              data={data}
              onAddPhotos={() => setShowAddPhotos(true)}
              onSelectOuting={(id) => navigate('outings', id)}
              onSelectSpecies={(name) => navigate('birddex', name)}
              onNavigate={(tab) => navigate(tab)}
            />
          </TabsContent>

          <TabsContent value="outings" className="mt-0">
            <OutingsPage
              data={data}
              selectedOutingId={tab === 'outings' ? (subId ?? null) : null}
              onSelectOuting={(id) => navigate('outings', id ?? undefined)}
              onSelectSpecies={(name) => navigate('birddex', name)}
            />
          </TabsContent>

          <TabsContent value="birddex" className="mt-0">
            <BirdDexPage
              data={data}
              selectedSpecies={tab === 'birddex' ? (subId ?? null) : null}
              onSelectSpecies={(name) => navigate('birddex', name ?? undefined)}
            />
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <SettingsPage data={data} user={user} />
          </TabsContent>
        </main>

        {/* ── Mobile bottom nav — hidden on desktop ────────── */}
        <nav className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-lg border-t border-border md:hidden z-50">
          <TabsList className="w-full h-16 bg-transparent grid grid-cols-4 rounded-none">
            {navItems.map(item => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                onClick={() => {
                  if (item.value === tab && subId) navigate(item.value)
                }}
                className="flex flex-col gap-1 data-[state=active]:text-primary"
              >
                <item.icon size={22} />
                <span className="text-[11px]">{item.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
      </Tabs>

      {showAddPhotos && (
        <AddPhotosFlow
          data={data}
          onClose={() => setShowAddPhotos(false)}
          userId={user.id}
        />
      )}


    </div>
  )
}

export default App
