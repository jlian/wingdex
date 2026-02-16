import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from 'next-themes'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import manifestUrl from './assets/manifest.webmanifest?url&no-inline'

import "./main.css"

function ensureManifestLink() {
  const existing = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null

  if (existing) {
    existing.href = manifestUrl
    return
  }

  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = manifestUrl
  document.head.appendChild(link)
}

async function bootstrap() {
  ensureManifestLink()

  const host = window.location.hostname.toLowerCase()
  const isSparkHosted = host === 'github.app' || host.endsWith('.github.app')

  if (isSparkHosted) {
    await import('@github/spark/spark')
  }

  createRoot(document.getElementById('spark-app')!).render(
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

void bootstrap()
