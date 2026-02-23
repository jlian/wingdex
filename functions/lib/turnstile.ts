const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface SiteverifyResponse {
  success: boolean
  'error-codes'?: string[]
}

/**
 * Verify a Cloudflare Turnstile token server-side.
 * Returns `true` when the token is valid.
 */
export async function verifyTurnstile(
  token: string,
  secretKey: string,
  remoteIp?: string | null,
): Promise<boolean> {
  const body: Record<string, string> = {
    secret: secretKey,
    response: token,
  }
  if (remoteIp) body.remoteip = remoteIp

  const res = await fetch(SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })

  if (!res.ok) return false

  const data = (await res.json()) as SiteverifyResponse
  return data.success === true
}
