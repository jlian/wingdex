import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from 'next-themes'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Toaster } from '@/components/ui/sonner'
import { MapPin, Bird, GithubLogo } from '@phosphor-icons/react'
import { useWingDexData } from '@/hooks/use-wingdex-data'
import { getStableDevUserId } from '@/lib/dev-user'

import HomePage, { HomeContentSkeleton } from '@/components/pages/HomePage'
import OutingsPage from '@/components/pages/OutingsPage'
import WingDexPage from '@/components/pages/WingDexPage'
import SettingsPage from '@/components/pages/SettingsPage'
import AddPhotosFlow from '@/components/flows/AddPhotosFlow'

interface UserInfo {
  login: string
  avatarUrl: string
  email: string
  id: number
  isOwner: boolean
}

function isSparkHostedRuntime(): boolean {
  const host = window.location.hostname.toLowerCase()
  return host === 'github.app' || host.endsWith('.github.app')
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
  if (['home', 'outings', 'wingdex', 'settings'].includes(segment)) {
    return { tab: segment, subId }
  }
  return { tab: 'home' }
}

function useHashRouter() {
  const [route, setRoute] = useState(parseHash)
  const navigatingWithSubId = useRef(false)

  useEffect(() => {
    const onChange = () => {
      // popstate fires on browser back/forward — restore saved scroll position
      const saved = window.history.state?.scrollY
      setRoute(parseHash())
      if (typeof saved === 'number') {
        // Defer so the DOM renders the target view first
        requestAnimationFrame(() => window.scrollTo(0, saved))
      }
    }
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])

  // Clear the guard after each render
  useEffect(() => { navigatingWithSubId.current = false })

  const navigate = useCallback((tab: string, subId?: string) => {
    // Save current scroll position in the current history entry before navigating away
    window.history.replaceState({ scrollY: window.scrollY }, '')

    const hash = subId
      ? `#${tab}/${encodeURIComponent(subId)}`
      : tab === 'home' ? '' : `#${tab}`
    window.history.pushState(null, '', hash || window.location.pathname)
    if (subId) navigatingWithSubId.current = true
    setRoute({ tab, subId })
    // Scroll to top on forward navigation into a detail view
    if (subId) window.scrollTo(0, 0)
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
  const [authError, setAuthError] = useState<string | null>(null)
  const [showApp, setShowApp] = useState(false)

  useEffect(() => {
    const fetchUser = async () => {
      const canUseDevFallback = !isSparkHostedRuntime()

      try {
        const userInfo = await window.spark.user()
        if (userInfo && typeof userInfo.login === 'string' && typeof userInfo.id === 'number') {
          setAuthError(null)
          setUser(userInfo)
        } else if (canUseDevFallback) {
          console.warn('Spark user API returned invalid data, using fallback:', userInfo)
          setAuthError(null)
          setUser(getFallbackUser())
        } else {
          console.error('Spark user API returned invalid data in hosted runtime:', userInfo)
          setAuthError('Unable to verify your user session. Refresh the page and try again.')
        }
      } catch (error) {
        if (canUseDevFallback) {
          console.warn('Spark user API unavailable, using fallback:', error)
          setAuthError(null)
          setUser(getFallbackUser())
        } else {
          console.error('Spark user API unavailable in hosted runtime:', error)
          setAuthError('Unable to verify your user session. Refresh the page and try again.')
        }
      }
    }
    fetchUser()
  }, [])

  useEffect(() => {
    if (!user) {
      setShowApp(false)
      return
    }

    const timer = window.setTimeout(() => {
      setShowApp(true)
    }, 50)

    return () => window.clearTimeout(timer)
  }, [user])

  if (authError) {
    return <AuthErrorShell message={authError} />
  }

  if (!user) {
    return <BootShell />
  }

  return (
    <div className={`transition-opacity duration-150 ease-out ${showApp ? 'opacity-100' : 'opacity-0'}`}>
      <AppContent user={user} />
    </div>
  )
}

function BootShell() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <div className="h-7 w-7 rounded-full bg-muted animate-pulse" />
            <div className="flex gap-2">
              <div className="h-8 w-20 rounded-md bg-muted animate-pulse" />
              <div className="h-8 w-20 rounded-md bg-muted animate-pulse" />
            </div>
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
          </div>
        </div>
      </header>

      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 space-y-6">
        <HomeContentSkeleton />
      </div>
    </div>
  )
}

function AuthErrorShell({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-background px-4">
      <div className="mx-auto max-w-md py-16">
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-lg font-semibold text-foreground">Sign-in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  )
}

function AppContent({ user }: { user: UserInfo }) {
  const { tab, subId, navigate, handleTabChange } = useHashRouter()
  const [showAddPhotos, setShowAddPhotos] = useState(false)
  const data = useWingDexData(user.id)
  const { resolvedTheme } = useTheme()

  // Sync <meta name="theme-color"> with current theme (#17)
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.setAttribute('content', resolvedTheme === 'dark' ? '#262e29' : '#e5ddd0')
    }
  }, [resolvedTheme])

  const navItems = [
    { value: 'wingdex', label: 'WingDex', icon: Bird },
    { value: 'outings', label: 'Outings', icon: MapPin },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />

      <Tabs value={tab} onValueChange={handleTabChange} activationMode="manual">
        {/* ── Top header — sticky at top, content scrolls beneath ── */}
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between h-14 sm:h-16">
              {/* Logo — navigates to Home */}
              <button
                onClick={() => navigate('home')}
                className="flex items-center gap-2 cursor-pointer hover:opacity-80 active:scale-[0.97] transition-all"
                aria-label="Home"
              >
                <Bird size={28} weight="duotone" className="text-primary" />
              </button>

              {/* Nav tabs — WingDex + Outings (Home via logo, Settings via avatar) */}
              <TabsList className="flex bg-transparent gap-1 h-auto p-0">
                {navItems.map(item => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    onClick={() => {
                      if (item.value === tab && subId) navigate(item.value)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-md text-sm font-medium cursor-pointer
                      data-[state=active]:bg-primary/10 data-[state=active]:text-primary
                      data-[state=inactive]:text-muted-foreground hover:text-foreground hover:bg-muted/50
                      active:scale-[0.97] transition-all"
                  >
                    <item.icon size={18} />
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* Right side: avatar — navigates to Settings */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate('settings')}
                  className="cursor-pointer hover:opacity-80 active:scale-[0.97] transition-all"
                  aria-label="Settings"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatarUrl} alt={user.login} />
                    <AvatarFallback>{user.login[0].toUpperCase()}</AvatarFallback>
                  </Avatar>
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* ── Main content ────────────────────────────────── */}
        <main className="w-full max-w-3xl mx-auto pb-8">
          <TabsContent value="home" className="mt-0" forceMount hidden={tab !== 'home'}>
            <HomePage
              data={data}
              onAddPhotos={() => setShowAddPhotos(true)}
              onSelectOuting={(id) => navigate('outings', id)}
              onSelectSpecies={(name) => navigate('wingdex', name)}
              onNavigate={(tab) => navigate(tab)}
            />
          </TabsContent>

          <TabsContent value="outings" className="mt-0" forceMount hidden={tab !== 'outings'}>
            <OutingsPage
              data={data}
              selectedOutingId={tab === 'outings' ? (subId ?? null) : null}
              onSelectOuting={(id) => navigate('outings', id ?? undefined)}
              onSelectSpecies={(name) => navigate('wingdex', name)}
            />
          </TabsContent>

          <TabsContent value="wingdex" className="mt-0" forceMount hidden={tab !== 'wingdex'}>
            <WingDexPage
              data={data}
              selectedSpecies={tab === 'wingdex' ? (subId ?? null) : null}
              onSelectSpecies={(name) => navigate('wingdex', name ?? undefined)}
              onSelectOuting={(id) => navigate('outings', id)}
            />
          </TabsContent>

          <TabsContent value="settings" className="mt-0" forceMount hidden={tab !== 'settings'}>
            <SettingsPage data={data} user={user} />
          </TabsContent>
        </main>
      </Tabs>

      {showAddPhotos && (
        <AddPhotosFlow
          data={data}
          onClose={() => setShowAddPhotos(false)}
          userId={user.id}
        />
      )}

      {/* Footer */}
      <div className="flex items-center justify-center gap-3 py-6 text-xs text-muted-foreground/50">
        <span>
          WingDex {typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'v1.1.0'} by{' '}
          <a href="https://johnlian.net" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
            John Lian
          </a>
        </span>
        <span>·</span>
        <a href="https://github.com/jlian/wingdex" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors" aria-label="GitHub">
          <GithubLogo size={14} />
        </a>
        <a href="https://github.com/jlian/wingdex/issues" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Report Issues
        </a>
      </div>

    </div>
  )
}

export default App
