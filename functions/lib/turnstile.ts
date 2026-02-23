const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface SiteverifyResponse {
  success: boolean
  hostname?: string
  action?: string
  'error-codes'?: string[]
}

function hostnameMatches(expectedHostname: string, actualHostname?: string): boolean {
  if (!actualHostname) return false

  const expected = expectedHostname.toLowerCase()
  const actual = actualHostname.toLowerCase()

  if (expected === actual) return true

  return expected.endsWith(`.${actual}`) || actual.endsWith(`.${expected}`)
}

/**
 * Verify a Cloudflare Turnstile token server-side.
 * Returns `true` when the token is valid.
 */
export async function verifyTurnstile(
  token: string,
  secretKey: string,
  remoteIp?: string | null,
  expectedHostname?: string | null,
  expectedAction?: string | null,
): Promise<boolean> {
  if (!token.trim()) return false

  const body: Record<string, string> = {
    secret: secretKey,
    response: token,
  }
  if (remoteIp) body.remoteip = remoteIp

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    })

    if (!res.ok) return false

    const data = (await res.json()) as SiteverifyResponse
    if (data.success !== true) return false

    if (expectedHostname && !hostnameMatches(expectedHostname, data.hostname)) {
      return false
    }

    if (expectedAction && data.action && data.action !== expectedAction) {
      return false
    }

    return true
  } catch {
    return false
  }
}
