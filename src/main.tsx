import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from 'next-themes'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'

import "./main.css"
import "./lib/touch-press" // iOS-style delayed press highlight for touch

// Clean up any previously-registered service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs =>
    regs.forEach(r => r.unregister())
  )
}

createRoot(document.getElementById('app')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <App />
    </ThemeProvider>
  </ErrorBoundary>
)
