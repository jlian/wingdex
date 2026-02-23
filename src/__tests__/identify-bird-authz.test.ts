import { describe, it, expect } from 'vitest'
import { onRequestPost } from '../../functions/api/identify-bird'

type IdentifyBirdContext = Parameters<typeof onRequestPost>[0]

function createContext(user?: { id?: string; isAnonymous?: boolean }): IdentifyBirdContext {
  return {
    request: new Request('https://wingdex.app/api/identify-bird', { method: 'POST' }),
    data: user ? { user } : {},
    env: {},
  } as unknown as IdentifyBirdContext
}

describe('identify-bird authorization', () => {
  it('returns 401 when no user is present in request context', async () => {
    const response = await onRequestPost(createContext())

    expect(response.status).toBe(401)
    await expect(response.text()).resolves.toBe('Unauthorized')
  })

  it('returns 403 for anonymous users', async () => {
    const response = await onRequestPost(createContext({ id: 'anon-1', isAnonymous: true }))

    expect(response.status).toBe(403)
    await expect(response.text()).resolves.toBe('Account required')
  })
})
