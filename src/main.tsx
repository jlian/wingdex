import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from 'next-themes'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'

import "./main.css"

async function bootstrap() {
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
