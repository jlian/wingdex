import { useState, useEffect } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Toaster } from '@/components/ui/sonner'
import { House, List, Bird, Gear, CloudArrowUp } from '@phosphor-icons/react'
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
        setUser(userInfo)
      } catch (error) {
        console.error('Failed to fetch user:', error)
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
              Your Personal Bird Life List & Sighting Tracker
            </p>
          </div>
          <Button size="lg" className="bg-primary text-primary-foreground">
            Sign in with GitHub
          </Button>
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

  return (
    <div className="min-h-screen bg-background pb-20">
      <Toaster position="top-center" />
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Bird size={28} weight="duotone" className="text-primary" />
            <h1 className="font-serif text-xl font-semibold text-foreground">
              BirdDex
            </h1>
          </div>
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.avatarUrl} alt={user.login} />
            <AvatarFallback>{user.login[0].toUpperCase()}</AvatarFallback>
          </Avatar>
        </div>
      </header>

      <main className="max-w-7xl mx-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
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

          <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border">
            <TabsList className="w-full h-16 bg-transparent grid grid-cols-4 rounded-none">
              <TabsTrigger
                value="home"
                className="flex flex-col gap-1 data-[state=active]:text-primary"
              >
                <House size={24} />
                <span className="text-xs">Home</span>
              </TabsTrigger>
              <TabsTrigger
                value="outings"
                className="flex flex-col gap-1 data-[state=active]:text-primary"
              >
                <List size={24} />
                <span className="text-xs">Outings</span>
              </TabsTrigger>
              <TabsTrigger
                value="lifelist"
                className="flex flex-col gap-1 data-[state=active]:text-primary"
              >
                <Bird size={24} />
                <span className="text-xs">Life List</span>
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="flex flex-col gap-1 data-[state=active]:text-primary"
              >
                <Gear size={24} />
                <span className="text-xs">Settings</span>
              </TabsTrigger>
            </TabsList>
          </nav>
        </Tabs>
      </main>

      {showAddPhotos && (
        <AddPhotosFlow
          data={data}
          onClose={() => setShowAddPhotos(false)}
          userId={user.id}
        />
      )}

      <Button
        size="lg"
        className="fixed bottom-20 right-4 h-14 w-14 rounded-full shadow-lg bg-accent text-accent-foreground"
        onClick={() => setShowAddPhotos(true)}
      >
        <CloudArrowUp size={28} weight="bold" />
      </Button>
    </div>
  )
}

export default App
