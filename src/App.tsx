import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useTheme } from 'next-themes'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Toaster } from '@/components/ui/sonner'
import { MapPin, Bird, GithubLogo } from '@phosphor-icons/react'
import { useWingDexData } from '@/hooks/use-wingdex-data'
import { getStableDevUserId } from '@/lib/dev-user'
import { authClient } from '@/lib/auth-client'
import type { OutingSortField, SortDir as OutingSortDir } from '@/components/pages/OutingsPage'
import type { SortField as WingDexSortField, SortDir as WingDexSortDir } from '@/components/pages/WingDexPage'

import HomePage, { HomeContentSkeleton } from '@/components/pages/HomePage'
import LoginPage from '@/components/pages/LoginPage'

const OutingsPage = lazy(() => import('@/components/pages/OutingsPage'))
const WingDexPage = lazy(() => import('@/components/pages/WingDexPage'))
const SettingsPage = lazy(() => import('@/components/pages/SettingsPage'))
const loadAddPhotosFlow = () => import('@/components/flows/AddPhotosFlow')
const AddPhotosFlow = lazy(loadAddPhotosFlow)

interface UserInfo {
  name: string
  image: string
  email: string
  id: string
}

function isDevRuntime(): boolean {
  const host = window.location.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1'
}

function getFallbackUser(): UserInfo {
  return {
    name: 'dev-user',
    image: '',
    email: 'dev@localhost',
    id: getStableDevUserId(),
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
  const sessionState = authClient.useSession()
  const session = sessionState.data
  const isSessionPending = sessionState.isPending
  const refetchSession = sessionState.refetch
  const localSessionBootstrapStarted = useRef(false)
  const [localSessionBootstrapFailed, setLocalSessionBootstrapFailed] = useState(false)
  const [user, setUser] = useState<UserInfo | null>(null)
  const authCompleted = useRef(false)
  // Tracks whether the initial session fetch resolved with a valid session
  // (returning user with a cookie). Set once, never cleared.
  const initialSessionResolved = useRef(false)
  const initialSessionChecked = useRef(false)

  // On the first non-pending session result, mark whether a valid session existed
  useEffect(() => {
    if (initialSessionChecked.current || isSessionPending) return
    initialSessionChecked.current = true
    if (session?.user && !Boolean((session.user as { isAnonymous?: boolean }).isAnonymous)) {
      initialSessionResolved.current = true
    }
  }, [session, isSessionPending])

  useEffect(() => {
    if (session && session.user) {
      const isAnonymousUser = !isDevRuntime() && Boolean((session.user as { isAnonymous?: boolean }).isAnonymous)
      if (isAnonymousUser) {
        setUser(null)
        return
      }

      // On hosted: only promote session → user when the page loaded with a
      // valid session (returning user) OR after LoginPage signals completion.
      // This prevents intermediate session changes during signup from causing
      // flashes of the authenticated UI.
      if (!isDevRuntime() && !authCompleted.current && !initialSessionResolved.current) {
        setUser(null)
        return
      }

      setLocalSessionBootstrapFailed(false)
      setUser({
        id: session.user.id,
        name: session.user.name || session.user.email || 'user',
        image: session.user.image || '',
        email: session.user.email || '',
      })
      return
    }

    if (isDevRuntime()) {
      if (localSessionBootstrapFailed) {
        setUser(getFallbackUser())
        return
      }

      if (!isSessionPending && !localSessionBootstrapStarted.current) {
        localSessionBootstrapStarted.current = true
        void authClient.signIn.anonymous().then((result) => {
          if (result.error) {
            setLocalSessionBootstrapFailed(true)
            return
          }
          void refetchSession()
        }).catch(() => {
          setLocalSessionBootstrapFailed(true)
          localSessionBootstrapStarted.current = false
        })
      }

      setUser(null)
      return
    }

    setUser(null)
  }, [session, isSessionPending, refetchSession, localSessionBootstrapFailed])

  const handleAuthenticated = useCallback(() => {
    authCompleted.current = true
    void refetchSession()
  }, [refetchSession])

  if (!user) {
    if (isSessionPending && !isDevRuntime()) {
      return <BootShell />
    }

    if (!isDevRuntime()) {
      return <LoginPage onAuthenticated={handleAuthenticated} />
    }

    return <BootShell />
  }

  return <AppContent user={user} />
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

function AppContent({ user }: { user: UserInfo }) {
  const { tab, subId, navigate, handleTabChange } = useHashRouter()
  const [showAddPhotos, setShowAddPhotos] = useState(false)
  const [wingDexSearchQuery, setWingDexSearchQuery] = useState('')
  const [wingDexSortField, setWingDexSortField] = useState<WingDexSortField>('date')
  const [wingDexSortDir, setWingDexSortDir] = useState<WingDexSortDir>('desc')
  const [outingsSearchQuery, setOutingsSearchQuery] = useState('')
  const [outingsSortField, setOutingsSortField] = useState<OutingSortField>('date')
  const [outingsSortDir, setOutingsSortDir] = useState<OutingSortDir>('desc')
  const data = useWingDexData(user.id)
  const { resolvedTheme } = useTheme()

  const prefetchAddPhotosFlow = useCallback(() => {
    void loadAddPhotosFlow()
    void import('@/lib/photo-utils')
    void import('@/lib/clustering')
    void import('@/lib/ai-inference')
  }, [])

  const toggleWingDexSort = useCallback((field: WingDexSortField) => {
    if (wingDexSortField === field) {
      setWingDexSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }

    setWingDexSortField(field)
    setWingDexSortDir(field === 'name' ? 'asc' : 'desc')
  }, [wingDexSortField])

  const toggleOutingsSort = useCallback((field: OutingSortField) => {
    if (outingsSortField === field) {
      setOutingsSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }

    setOutingsSortField(field)
    setOutingsSortDir('desc')
  }, [outingsSortField])

  // Sync <meta name="theme-color"> with current theme (#17)
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.setAttribute('content', resolvedTheme === 'dark' ? '#262e29' : '#e5ddd0')
    }
  }, [resolvedTheme])

  useEffect(() => {
    let idleCallbackId: number | null = null
    let timeoutId: number | null = null

    if (typeof window.requestIdleCallback === 'function') {
      idleCallbackId = window.requestIdleCallback(() => {
        prefetchAddPhotosFlow()
      })
    } else {
      timeoutId = window.setTimeout(() => {
        prefetchAddPhotosFlow()
      }, 300)
    }

    return () => {
      if (idleCallbackId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallbackId)
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [prefetchAddPhotosFlow])

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
                    <AvatarImage src={user.image} alt={user.name} />
                    <AvatarFallback>{user.name[0].toUpperCase()}</AvatarFallback>
                  </Avatar>
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* ── Main content ────────────────────────────────── */}
        <main className="w-full max-w-3xl mx-auto pb-8">
          {tab === 'home' && (
            <TabsContent value="home" className="mt-0">
              <HomePage
                data={data}
                onAddPhotos={() => setShowAddPhotos(true)}
                onAddPhotosIntent={prefetchAddPhotosFlow}
                onSelectOuting={(id) => navigate('outings', id)}
                onSelectSpecies={(name) => navigate('wingdex', name)}
                onNavigate={(tab) => navigate(tab)}
              />
            </TabsContent>
          )}

          {tab === 'outings' && (
            <TabsContent value="outings" className="mt-0">
              <Suspense fallback={<ListPageLoadingFallback title="Your Outings" />}>
                <OutingsPage
                  data={data}
                  selectedOutingId={subId ?? null}
                  onSelectOuting={(id) => navigate('outings', id ?? undefined)}
                  onSelectSpecies={(name) => navigate('wingdex', name)}
                  searchQuery={outingsSearchQuery}
                  onSearchQueryChange={setOutingsSearchQuery}
                  sortField={outingsSortField}
                  sortDir={outingsSortDir}
                  onToggleSort={toggleOutingsSort}
                />
              </Suspense>
            </TabsContent>
          )}

          {tab === 'wingdex' && (
            <TabsContent value="wingdex" className="mt-0">
              <Suspense fallback={<ListPageLoadingFallback title="WingDex" />}>
                <WingDexPage
                  data={data}
                  selectedSpecies={subId ?? null}
                  onSelectSpecies={(name) => navigate('wingdex', name ?? undefined)}
                  onSelectOuting={(id) => navigate('outings', id)}
                  searchQuery={wingDexSearchQuery}
                  onSearchQueryChange={setWingDexSearchQuery}
                  sortField={wingDexSortField}
                  sortDir={wingDexSortDir}
                  onToggleSort={toggleWingDexSort}
                />
              </Suspense>
            </TabsContent>
          )}

          {tab === 'settings' && (
            <TabsContent value="settings" className="mt-0">
              <Suspense fallback={<SettingsLoadingFallback />}>
                <SettingsPage data={data} user={user} />
              </Suspense>
            </TabsContent>
          )}
        </main>
      </Tabs>

      {showAddPhotos && (
        <Suspense fallback={null}>
          <AddPhotosFlow
            data={data}
            onClose={() => setShowAddPhotos(false)}
            userId={user.id}
          />
        </Suspense>
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

function ListPageLoadingFallback({ title }: { title: string }) {
  return (
    <div className="px-4 sm:px-6 py-6 space-y-4 max-w-3xl mx-auto">
      <div className="space-y-2">
        <p className="font-serif text-2xl font-semibold text-foreground">{title}</p>
        <div className="h-4 w-40 rounded bg-muted animate-pulse" />
      </div>

      <div className="flex items-center gap-2">
        <div className="h-9 flex-1 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-14 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-14 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-14 rounded-md bg-muted animate-pulse" />
      </div>

      <div className="space-y-1">
        <div className="h-14 w-full rounded-lg bg-muted animate-pulse" />
        <div className="h-14 w-full rounded-lg bg-muted animate-pulse" />
        <div className="h-14 w-full rounded-lg bg-muted animate-pulse" />
        <div className="h-14 w-full rounded-lg bg-muted animate-pulse" />
      </div>
    </div>
  )
}

function SettingsLoadingFallback() {
  return (
    <div className="px-4 sm:px-6 py-6 space-y-3 max-w-3xl mx-auto">
      <div className="h-7 w-32 rounded-md bg-muted animate-pulse" />
      <div className="h-24 w-full rounded-lg bg-muted animate-pulse" />
      <div className="h-16 w-full rounded-lg bg-muted animate-pulse" />
    </div>
  )
}

export default App
