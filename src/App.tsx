import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useTheme } from 'next-themes'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Toaster } from '@/components/ui/sonner'
import { MapPin, Bird, GithubLogo } from '@phosphor-icons/react'
import { useWingDexData } from '@/hooks/use-wingdex-data'
import { getStableDevUserId } from '@/lib/dev-user'
import { authClient } from '@/lib/auth-client'
import { getEmojiAvatarColor } from '@/lib/fun-names'
import { useAuthGate } from '@/hooks/use-auth-gate'
import { loadDemoData } from '@/lib/demo-data'
import type { OutingSortField, SortDir as OutingSortDir } from '@/components/pages/OutingsPage'
import type { SortField as WingDexSortField, SortDir as WingDexSortDir } from '@/components/pages/WingDexPage'

import HomePage from '@/components/pages/HomePage'

const OutingsPage = lazy(() => import('@/components/pages/OutingsPage'))
const WingDexPage = lazy(() => import('@/components/pages/WingDexPage'))
const SettingsPage = lazy(() => import('@/components/pages/SettingsPage'))
const TermsPage = lazy(() => import('@/components/pages/TermsPage'))
const PrivacyPage = lazy(() => import('@/components/pages/PrivacyPage'))
const loadAddPhotosFlow = () => import('@/components/flows/AddPhotosFlow')
const AddPhotosFlow = lazy(loadAddPhotosFlow)

interface UserInfo {
  name: string
  image: string
  email: string
  id: string
  isAnonymous: boolean
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
    isAnonymous: false,
  }
}

// ─── URL Hash Router ──────────────────────────────────────

function parseHash(): { tab: string; subId?: string } {
  const hash = window.location.hash.slice(1)
  if (!hash) return { tab: 'home' }
  const [segment, ...rest] = hash.split('/')
  const subId = rest.length > 0 ? decodeURIComponent(rest.join('/')) : undefined
  if (['home', 'outings', 'wingdex', 'settings', 'terms', 'privacy'].includes(segment)) {
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
  const anonBootstrapStarted = useRef(false)
  const hadSessionRef = useRef(false)
  const [anonBootstrapFailed, setAnonBootstrapFailed] = useState(false)
  const [user, setUser] = useState<UserInfo | null>(null)

  useEffect(() => {
    if (session && session.user) {
      hadSessionRef.current = true
      anonBootstrapStarted.current = false
      const isAnon = Boolean((session.user as { isAnonymous?: boolean }).isAnonymous)

      setAnonBootstrapFailed(false)
      setUser({
        id: session.user.id,
        name: session.user.name || session.user.email || 'user',
        image: session.user.image || '',
        email: session.user.email || '',
        isAnonymous: isAnon,
      })
      return
    }

    // Only reset bootstrap guard when transitioning from a real session
    // to no session (e.g. after sign-out).
    if (hadSessionRef.current) {
      hadSessionRef.current = false
      anonBootstrapStarted.current = false
    }

    if (isDevRuntime()) {
      if (anonBootstrapFailed) {
        setUser(getFallbackUser())
        return
      }

      if (!isSessionPending && !anonBootstrapStarted.current) {
        anonBootstrapStarted.current = true
        void authClient.signIn.anonymous().then((result) => {
          if (result.error) {
            setAnonBootstrapFailed(true)
            return
          }
          void refetchSession()
        }).catch(() => {
          setAnonBootstrapFailed(true)
          anonBootstrapStarted.current = false
        })
      }

      setUser(null)
      return
    }

    // Hosted: auto-bootstrap anonymous session (demo-first)
    if (anonBootstrapFailed) {
      // Auth backend unreachable — stop retrying to avoid tight loop.
      // User must reload to reattempt.
      return
    }

    if (!isSessionPending && !anonBootstrapStarted.current) {
      anonBootstrapStarted.current = true
      void authClient.signIn.anonymous({
        fetchOptions: {
          headers: { 'x-wingdex-passkey-signup': '1' },
        },
      }).then((result) => {
        if (result.error) {
          setAnonBootstrapFailed(true)
          return
        }
        void refetchSession()
      }).catch(() => {
        setAnonBootstrapFailed(true)
      })
    }

    setUser(null)
  }, [session, isSessionPending, refetchSession, anonBootstrapFailed])

  if (!user) {
    return <BootShell />
  }

  return <AppContent user={user} refetchSession={refetchSession} />
}

function BootShell() {
  return <div className="min-h-screen bg-background" />
}

function AppContent({ user, refetchSession }: { user: UserInfo; refetchSession: () => Promise<unknown> }) {
  const { tab, subId, navigate, handleTabChange } = useHashRouter()
  const [showAddPhotos, setShowAddPhotos] = useState(false)
  const data = useWingDexData(user.id)

  const { requireAuth, openSignIn, authGateModal } = useAuthGate({
    isAnonymous: user.isAnonymous,
    onUpgraded: async () => {
      await refetchSession()
    },
    demoDataEnabled: user.isAnonymous && (data.dex.length > 0 || data.outings.length > 0),
    onSetDemoDataEnabled: async (enabled) => {
      if (!user.isAnonymous) return
      if (enabled) {
        await loadDemoData(data)
        return
      }
      data.clearAllData()
      await data.refresh()
    },
  })
  const [wingDexSearchQuery, setWingDexSearchQuery] = useState('')
  const [wingDexSortField, setWingDexSortField] = useState<WingDexSortField>('date')
  const [wingDexSortDir, setWingDexSortDir] = useState<WingDexSortDir>('desc')
  const [outingsSearchQuery, setOutingsSearchQuery] = useState('')
  const [outingsSortField, setOutingsSortField] = useState<OutingSortField>('date')
  const [outingsSortDir, setOutingsSortDir] = useState<OutingSortDir>('desc')
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
    setOutingsSortDir(field === 'name' ? 'asc' : 'desc')
  }, [outingsSortField])

  // Sync <meta name="theme-color"> with current theme (#17)
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.setAttribute('content', resolvedTheme === 'dark' ? '#262e29' : '#e5ddd0')
    }
  }, [resolvedTheme])

  useEffect(() => {
    if (user.isAnonymous && tab === 'settings') {
      navigate('home')
    }
  }, [user.isAnonymous, tab, navigate])

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
    <div className="min-h-screen bg-background flex flex-col">
      <Toaster position="bottom-center" />

      <Tabs value={tab} onValueChange={handleTabChange} activationMode="manual" className="flex-1 flex flex-col">
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

              {/* Right side: sign-in (anonymous) or avatar (authenticated) */}
              <div className="flex items-center gap-3">
                {user.isAnonymous ? (
                  <button
                    onClick={openSignIn}
                    className="inline-flex items-center rounded-md px-2.5 py-1.5 text-sm font-semibold text-primary cursor-pointer hover:bg-primary/10 active:scale-[0.97] transition-all"
                  >
                    Log in
                  </button>
                ) : (
                  <button
                    onClick={() => navigate('settings')}
                    className="cursor-pointer active:scale-[0.97] transition-all"
                    aria-label="Settings"
                  >
                    <Avatar className={`h-8 w-8 ${getEmojiAvatarColor(user.image) || 'bg-muted'} hover:opacity-80 transition-opacity`}>
                      <AvatarImage src={user.image} alt={user.name} className="scale-[0.65] object-contain" />
                      <AvatarFallback className="bg-muted text-muted-foreground text-xs">{user.name[0].toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ── Main content ────────────────────────────────── */}
        <main className="w-full max-w-3xl mx-auto pb-8 flex-1">
          {tab === 'home' && (
            <TabsContent value="home" className="mt-0">
              <HomePage
                data={data}
                onAddPhotos={() => requireAuth(() => setShowAddPhotos(true))}
                onAddPhotosIntent={prefetchAddPhotosFlow}
                onSelectOuting={(id) => navigate('outings', id)}
                onSelectSpecies={(name) => navigate('wingdex', name)}
                onNavigate={(tab) => navigate(tab)}
              />
            </TabsContent>
          )}

          {tab === 'outings' && (
            <TabsContent value="outings" className="mt-0">
              <Suspense fallback={null}>
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
              <Suspense fallback={null}>
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
              <Suspense fallback={null}>
                <SettingsPage
                  data={data}
                  user={user}
                  onSignIn={openSignIn}
                  onSignedOut={() => navigate('home')}
                  onProfileUpdated={refetchSession}
                />
              </Suspense>
            </TabsContent>
          )}

          {tab === 'terms' && (
            <TabsContent value="terms" className="mt-0">
              <Suspense fallback={null}>
                <TermsPage />
              </Suspense>
            </TabsContent>
          )}

          {tab === 'privacy' && (
            <TabsContent value="privacy" className="mt-0">
              <Suspense fallback={null}>
                <PrivacyPage />
              </Suspense>
            </TabsContent>
          )}
        </main>
      </Tabs>

      {authGateModal}

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
      <div className="mt-auto flex items-center justify-center gap-3 py-6 text-xs text-muted-foreground/50">
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
        <button onClick={() => navigate('privacy')} className="hover:text-muted-foreground transition-colors cursor-pointer">
          Privacy
        </button>
        <button onClick={() => navigate('terms')} className="hover:text-muted-foreground transition-colors cursor-pointer">
          Terms
        </button>
        <a href="https://github.com/jlian/wingdex/issues" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Issues?
        </a>
      </div>

    </div>
  )
}

export default App
