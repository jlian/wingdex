import { useState, useCallback, useRef } from 'react'
import { Key, GithubLogo, AppleLogo } from '@phosphor-icons/react'

import { authClient } from '@/lib/auth-client'
import { generateBirdName } from '@/lib/fun-names'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

/** Safely extract error code from Better Auth error union */
function errCode(err: { code?: string; message?: string }): string | undefined {
  return 'code' in err ? err.code : undefined
}

function isCancellationLike(err: { code?: string; message?: string }): boolean {
  const code = errCode(err)
  if (code === 'AUTH_CANCELLED' || code === 'ERROR_CEREMONY_ABORTED') return true
  const msg = (err.message || '').toLowerCase()
  return msg.includes('not allowed by the user agent')
    || msg.includes('notallowederror')
    || msg.includes('request is not allowed')
}

interface AuthGateOptions {
  isAnonymous: boolean
  onUpgraded: () => void | Promise<void>
  demoDataEnabled?: boolean
  onSetDemoDataEnabled?: (enabled: boolean) => Promise<void> | void
}

type AuthMode = 'signup' | 'login'

/**
 * Hook that gates actions behind authentication.
 * Returns `requireAuth(callback)` — if user is anonymous, opens sign-up modal.
 * If user is already authenticated, runs the callback immediately.
 * Also returns `<AuthGateModal />` to render once in the tree.
 */
export function useAuthGate({ isAnonymous, onUpgraded, demoDataEnabled, onSetDemoDataEnabled }: AuthGateOptions) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AuthMode>('signup')
  const pendingCallback = useRef<(() => void) | null>(null)

  const requireAuth = useCallback((callback: () => void) => {
    if (!isAnonymous) {
      callback()
      return
    }
    pendingCallback.current = callback
    setMode('signup')
    setOpen(true)
  }, [isAnonymous])

  const openSignIn = useCallback(() => {
    pendingCallback.current = null
    setMode('login')
    setOpen(true)
  }, [])

  const handleUpgraded = useCallback(async () => {
    setOpen(false)
    await onUpgraded()
    const callback = pendingCallback.current
    pendingCallback.current = null
    callback?.()
  }, [onUpgraded])

  const modal = (
    <AuthGateModal
      open={open}
      onOpenChange={setOpen}
      mode={mode}
      onModeChange={setMode}
      onUpgraded={handleUpgraded}
      demoDataEnabled={demoDataEnabled}
      onSetDemoDataEnabled={onSetDemoDataEnabled}
    />
  )

  return { requireAuth, openSignIn, AuthGateModal: modal }
}

// ─── Modal ──────────────────────────────────────────────

interface AuthGateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onUpgraded: () => void
  demoDataEnabled?: boolean
  onSetDemoDataEnabled?: (enabled: boolean) => Promise<void> | void
}

function AuthGateModal({
  open,
  onOpenChange,
  mode,
  onModeChange,
  onUpgraded,
  demoDataEnabled,
  onSetDemoDataEnabled,
}: AuthGateModalProps) {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isTogglingDemo, setIsTogglingDemo] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [providers, setProviders] = useState<string[] | null>(null)
  const isLocalRuntime = typeof window !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(window.location.hostname.toLowerCase())
  const visibleProviders = providers && providers.length > 0
    ? providers
    : (isLocalRuntime ? ['github', 'apple'] : [])

  // Fetch providers on first open
  const fetchedProviders = useRef(false)
  if (open && !fetchedProviders.current) {
    fetchedProviders.current = true
    void fetch('/api/auth/providers').then(r => r.ok ? r.json() : null).then(
      (data: { providers: string[] } | null) => { if (data) setProviders(data.providers) },
    )
  }

  const handleSignUpWithPasskey = async () => {
    setErrorMessage(null)
    setIsLoading(true)

    const trimmedEmail = email.trim().toLowerCase()

    // If email provided, check if account exists — route to sign-in
    if (trimmedEmail) {
      try {
        const checkRes = await fetch(`/api/auth/check-email?email=${encodeURIComponent(trimmedEmail)}`)
        if (checkRes.ok) {
          const { exists } = await checkRes.json() as { exists: boolean }
          if (exists) {
            // Account exists — sign in with passkey
            const signInResult = await authClient.signIn.passkey({ autoFill: false })
            if (signInResult.error) {
              setIsLoading(false)
              if (isCancellationLike(signInResult.error)) {
                return
              } else {
                setErrorMessage(signInResult.error.message || 'Sign-in failed.')
              }
              return
            }
            setIsLoading(false)
            onUpgraded()
            return
          }
        }
      } catch {
        // If check fails, proceed with registration
      }
    }

    // Create account: the current session is already anonymous, so just
    // register a passkey on it and finalize.
    const birdName = generateBirdName()
    const passkeyLabel = trimmedEmail || birdName

    const passkeyResult = await authClient.passkey.addPasskey({
      name: passkeyLabel,
      authenticatorAttachment: 'platform',
    })
    if (passkeyResult.error) {
      setIsLoading(false)
      if (isCancellationLike(passkeyResult.error)) {
        return
      } else if (errCode(passkeyResult.error) === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
        setErrorMessage('This device already has a passkey. Try Log in instead.')
      } else {
        setErrorMessage(passkeyResult.error.message || 'Passkey registration failed.')
      }
      return
    }

    // Finalize — flip anonymous → real user
    const finalizeRes = await fetch('/api/auth/finalize-passkey', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: birdName,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
      }),
    })
    if (!finalizeRes.ok) {
      const data = await finalizeRes.json().catch(() => null) as { error?: string } | null
      setIsLoading(false)
      if (data?.error === 'email_taken') {
        setErrorMessage('That email is already associated with an account. Try signing in instead.')
      } else {
        setErrorMessage('Account setup failed. Please try again.')
      }
      return
    }

    setIsLoading(false)
    onUpgraded()
  }

  const handlePasskeySignIn = async () => {
    setErrorMessage(null)
    setIsLoading(true)

    const result = await authClient.signIn.passkey({ autoFill: false })
    if (result.error) {
      setIsLoading(false)
      if (isCancellationLike(result.error)) {
        return
      } else {
        setErrorMessage(result.error.message || 'Passkey sign-in failed.')
      }
      return
    }

    // Verify it's a real (non-anonymous) session
    const sessionResult = await authClient.getSession()
    const isAnonymous = Boolean(
      (sessionResult.data?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous,
    )
    if (isAnonymous || !sessionResult.data?.user) {
      await authClient.signOut()
      setIsLoading(false)
      setErrorMessage('No account found for that passkey.')
      return
    }

    setIsLoading(false)
    onUpgraded()
  }

  const handleSocialSignIn = (provider: 'github' | 'apple') => {
    setErrorMessage(null)
    void authClient.signIn.social({ provider })
  }

  const handleDemoToggle = async (enabled: boolean) => {
    if (!onSetDemoDataEnabled) return
    setIsTogglingDemo(true)
    setErrorMessage(null)
    try {
      await onSetDemoDataEnabled(enabled)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error'
      setErrorMessage(`Demo data update failed: ${detail}`)
    } finally {
      setIsTogglingDemo(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'signup' ? 'Sign up' : 'Log in'}</DialogTitle>
          <DialogDescription>
            By continuing you accept our{' '}
            <a
              href="#terms"
              onClick={() => onOpenChange(false)}
              className="text-primary underline-offset-4 hover:underline"
            >
              Terms of Use
            </a>{' '}
            and{' '}
            <a
              href="#privacy"
              onClick={() => onOpenChange(false)}
              className="text-primary underline-offset-4 hover:underline"
            >
              Privacy Policy
            </a>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Social providers — top, like Reddit */}
          {visibleProviders.length > 0 && (
            <div className="space-y-2">
              {visibleProviders.includes('github') && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSocialSignIn('github')}
                  disabled={isLoading}
                >
                  <GithubLogo size={18} className="mr-2" />
                  Continue with GitHub
                </Button>
              )}
              {visibleProviders.includes('apple') && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSocialSignIn('apple')}
                  disabled={isLoading}
                >
                  <AppleLogo size={18} className="mr-2" />
                  Continue with Apple
                </Button>
              )}
            </div>
          )}

          {/* OR divider */}
          {visibleProviders.length > 0 && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>
          )}

          {/* Email + passkey */}
          <div className="space-y-3">
            {mode === 'signup' && (
              <Input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                placeholder="Email (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                aria-label="Email address"
              />
            )}
            <Button
              className="w-full"
              onClick={() => void (mode === 'signup' ? handleSignUpWithPasskey() : handlePasskeySignIn())}
              disabled={isLoading}
            >
              <Key size={18} className="mr-2" />
              {isLoading
                ? 'Working…'
                : (mode === 'signup' ? 'Sign up with a Passkey' : 'Log in with a Passkey')}
            </Button>
          </div>

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'signup' ? (
              <>
                Already have a WingDex?{' '}
                <button
                  className="text-primary underline-offset-4 hover:underline cursor-pointer"
                  onClick={() => {
                    setErrorMessage(null)
                    onModeChange('login')
                  }}
                  disabled={isLoading}
                >
                  Log in
                </button>
              </>
            ) : (
              <>
                New to WingDex?{' '}
                <button
                  className="text-primary underline-offset-4 hover:underline cursor-pointer"
                  onClick={() => {
                    setErrorMessage(null)
                    onModeChange('signup')
                  }}
                  disabled={isLoading}
                >
                  Sign up
                </button>
              </>
            )}
          </p>

          {mode === 'signup' && typeof demoDataEnabled === 'boolean' && onSetDemoDataEnabled && (
            <div className="pt-1">
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Demo data</p>
                  <p className="text-xs text-muted-foreground">Preview WingDex with sample sightings</p>
                </div>
                <Switch
                  checked={demoDataEnabled}
                  onCheckedChange={(checked) => void handleDemoToggle(checked)}
                  disabled={isLoading || isTogglingDemo}
                  aria-label="Toggle demo data"
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
