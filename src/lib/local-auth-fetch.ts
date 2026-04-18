import { authClient } from '@/lib/auth-client'
import { generateTraceparent } from '@/lib/trace'

export function isLocalRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1'
}

/** Inject traceparent header into fetch init for distributed tracing. */
function withTraceparent(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  if (!headers.has('traceparent')) {
    headers.set('traceparent', generateTraceparent())
  }
  return { ...init, headers }
}

export async function fetchWithLocalAuthRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const tracedInit = withTraceparent(init)
  const firstResponse = await fetch(input, tracedInit)
  if (firstResponse.status !== 401 || !isLocalRuntime()) {
    return firstResponse
  }

  const signInResult = await authClient.signIn.anonymous()
  if (signInResult.error) {
    return firstResponse
  }

  return fetch(input, tracedInit)
}
