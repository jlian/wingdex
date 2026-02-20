import { authClient } from '@/lib/auth-client'

export function isLocalRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1'
}

export async function fetchWithLocalAuthRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const firstResponse = await fetch(input, init)
  if (firstResponse.status !== 401 || !isLocalRuntime()) {
    return firstResponse
  }

  const signInResult = await authClient.signIn.anonymous()
  if (signInResult.error) {
    return firstResponse
  }

  return fetch(input, init)
}
