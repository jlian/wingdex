import { ErrorBoundary } from 'react-error-boundary'
import { ThemeProvider } from 'next-themes'
import { ErrorFallback } from './ErrorFallback'
import LandingGateway from './LandingGateway'

export default function Root() {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <LandingGateway />
      </ThemeProvider>
    </ErrorBoundary>
  )
}
