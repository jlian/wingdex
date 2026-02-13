import { useState, useEffect } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Toaster } from '@/components/ui/sonner'
import { House, List, Bird, Gear, CloudArrowUp, Plus } from '@phosphor-icons/react'
import { useBirdDexData } from '@/hooks/use-birddex-data'

import HomePage from '@/components/pages/HomePage'
import OutingsPage from '@/components/pages/OutingsPage'
import LifeListPage from '@/components/pages/LifeListPage'
import SettingsPage from '@/components/pages/SettingsPage'
import AddPhotosFlow from '@/components/flows/AddPhotosFlow'

interface UserInfo {
  login: string
  avatarUrl: string
  email: string
  id: number
  isOwner: boolean
}

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
          setUser({
            login: 'dev-user',
            avatarUrl: '',
            email: 'dev@localhost',
            id: 1,
            isOwner: true,
          })
        }
      } catch (error) {
        console.warn('Spark user API unavailable, using fallback:', error)
        setUser({
          login: 'dev-user',
          avatarUrl: '',
          email: 'dev@localhost',
          id: 1,
          isOwner: true,
        })
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
  const [activeTab, setActiveTab] = useState('home')
  const [showAddPhotos, setShowAddPhotos] = useState(false)
  const data = useBirdDexData(user.id)

  const navItems = [
    { value: 'home', label: 'Home', icon: House },
    { value: 'outings', label: 'Outings', icon: List },
    { value: 'lifelist', label: 'Life List', icon: Bird },
    { value: 'settings', label: 'Settings', icon: Gear },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* ── Top header + desktop nav ──────────────────────── */}
        <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-lg border-b border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between h-14 sm:h-16">
              {/* Logo */}
              <div className="flex items-center gap-2">
                <Bird size={28} weight="duotone" className="text-primary" />
                <h1 className="font-serif text-xl font-semibold text-foreground">
                  BirdDex
                </h1>
              </div>

              {/* Desktop nav — hidden on mobile */}
              <TabsList className="hidden md:flex bg-transparent gap-1 h-auto p-0">
                {navItems.map(item => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
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
                  className="hidden sm:flex bg-accent text-accent-foreground hover:bg-accent/90"
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
        <main className="max-w-6xl mx-auto pb-20 md:pb-8">
          <TabsContent value="home" className="mt-0">
            <HomePage
              data={data}
              onAddPhotos={() => setShowAddPhotos(true)}
            />
          </TabsContent>

          <TabsContent value="outings" className="mt-0">
            <OutingsPage data={data} />
          </TabsContent>

          <TabsContent value="lifelist" className="mt-0">
            <LifeListPage data={data} />
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

      {/* Mobile FAB — hidden on desktop (desktop has header button) */}
      <Button
        size="lg"
        className="fixed bottom-20 right-4 h-14 w-14 rounded-full shadow-lg bg-accent text-accent-foreground md:hidden z-40"
        onClick={() => setShowAddPhotos(true)}
      >
        <CloudArrowUp size={28} weight="bold" />
      </Button>
    </div>
  )
}

export default App
