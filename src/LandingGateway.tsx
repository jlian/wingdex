import { lazy, Suspense, useEffect, useState } from 'react'
import LandingPage from './components/pages/LandingPage'
import { authClient } from './lib/auth-client'

const App = lazy(() => import('./App'))

export default function LandingGateway() {
  const session = authClient.useSession()
  const [ready, setReady] = useState(false)
  const [sessionResolved, setSessionResolved] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])
  useEffect(() => {
    if (!session.isPending) setSessionResolved(true)
  }, [session.isPending])

  if (!ready) return <LandingPage />
  if (!sessionResolved) return <div className="min-h-dvh" role="status" aria-label="Loading WingDex" />
  return <Suspense fallback={<div className="min-h-dvh" role="status" aria-label="Loading WingDex" />}>
    <App initialUpload={window.location.hash === '#upload'} />
  </Suspense>
}
