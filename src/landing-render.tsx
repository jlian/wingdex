import { renderToString } from 'react-dom/server'
import Root from './Root'
import { AppFooter, AppHeader } from './components/AppChrome'
import PrivacyPage from './components/pages/PrivacyPage'
import TermsPage from './components/pages/TermsPage'
import type { ReactNode } from 'react'

export function render() {
  return renderToString(<Root />)
}

function LegalDocument({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <AppHeader>
        <div className="h-8 w-8" />
      </AppHeader>
      <main className="flex-1">{children}</main>
      <AppFooter />
    </div>
  )
}

export function renderLegalPage(page: 'privacy' | 'terms') {
  return renderToString(
    <LegalDocument>
      {page === 'privacy' ? <PrivacyPage /> : <TermsPage />}
    </LegalDocument>,
  )
}
