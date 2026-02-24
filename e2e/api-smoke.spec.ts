import { test, expect, request } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const API_BASE = 'http://localhost:5000'

function buildCookieHeader(setCookieHeaders: string[]) {
  return setCookieHeaders
    .map(value => value.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

async function waitForServerReady(baseURL: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/api/auth/get-session`)
      if (response.ok) return
    } catch {
      // keep polling
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for Wrangler server at ${baseURL}`)
}

test.describe('API smoke (request context)', () => {
  test.beforeAll(async () => {
    await waitForServerReady(API_BASE, 20_000)
  })

  test('anonymous auth + protected data CRUD', async () => {
    const api = await request.newContext({ baseURL: API_BASE })

    const unauthSession = await api.get('/api/auth/get-session')
    expect(unauthSession.status()).toBe(200)
    expect(await unauthSession.json()).toBeNull()

    const signIn = await api.post('/api/auth/sign-in/anonymous', {
      data: {},
    })
    expect(signIn.status()).toBe(200)
    const signInJson = await signIn.json()
    expect(signInJson?.token).toBeTruthy()
    expect(signInJson?.user?.id).toBeTruthy()

    const authCookie = buildCookieHeader(
      signIn
        .headersArray()
        .filter(header => header.name.toLowerCase() === 'set-cookie')
        .map(header => header.value),
    )
    expect(authCookie).toBeTruthy()

    const authSession = await api.get('/api/auth/get-session', {
      headers: { cookie: authCookie },
    })
    expect(authSession.status()).toBe(200)
    const authSessionJson = await authSession.json()
    expect(authSessionJson?.user?.id).toBeTruthy()

    const initialData = await api.get('/api/data/all', {
      headers: { cookie: authCookie },
    })
    expect(initialData.status()).toBe(200)
    const initialJson = await initialData.json()
    expect(Array.isArray(initialJson.outings)).toBe(true)

    const outingId = `api-smoke-${Date.now()}`
    const createOuting = await api.post('/api/data/outings', {
      headers: { cookie: authCookie },
      data: {
        id: outingId,
        startTime: '2026-02-20T08:00:00.000Z',
        endTime: '2026-02-20T09:00:00.000Z',
        locationName: 'API Smoke Park',
        createdAt: '2026-02-20T09:00:00.000Z',
      },
    })
    expect(createOuting.status()).toBe(200)

    const postCreateData = await api.get('/api/data/all', {
      headers: { cookie: authCookie },
    })
    expect(postCreateData.status()).toBe(200)
    const postCreateJson = await postCreateData.json()
    expect(postCreateJson.outings.some((outing: { id: string }) => outing.id === outingId)).toBe(true)

    await api.dispose()
  })

  test('realistic eBird CSV import preview + confirm (multiple fixtures)', async () => {
    const api = await request.newContext({ baseURL: API_BASE })

    const signIn = await api.post('/api/auth/sign-in/anonymous', { data: {} })
    expect(signIn.status()).toBe(200)

    const authCookie = buildCookieHeader(
      signIn
        .headersArray()
        .filter(header => header.name.toLowerCase() === 'set-cookie')
        .map(header => header.value),
    )
    expect(authCookie).toBeTruthy()

    const fixturePaths = [
      'e2e/fixtures/ebird-import.csv',
      'e2e/fixtures/ebird-import-variant.csv',
    ]

    for (const fixturePath of fixturePaths) {
      const csvPath = path.resolve(fixturePath)
      const csvBuffer = readFileSync(csvPath)

      const preview = await api.post('/api/import/ebird-csv', {
        headers: { cookie: authCookie },
        multipart: {
          file: {
            name: path.basename(fixturePath),
            mimeType: 'text/csv',
            buffer: csvBuffer,
          },
        },
      })

      expect(preview.status(), `preview should succeed for ${fixturePath}`).toBe(200)
      const previewJson = await preview.json()
      expect(Array.isArray(previewJson.previews)).toBe(true)
      expect(previewJson.previews.length, `previews should exist for ${fixturePath}`).toBeGreaterThan(0)

      const previewIds = previewJson.previews
        .map((entry: { previewId?: string }) => entry.previewId)
        .filter((id: string | undefined): id is string => !!id)

      expect(previewIds.length, `preview IDs should exist for ${fixturePath}`).toBeGreaterThan(0)

      const confirm = await api.post('/api/import/ebird-csv/confirm', {
        headers: { cookie: authCookie },
        data: { previewIds },
      })

      expect(confirm.status(), `confirm should succeed for ${fixturePath}`).toBe(200)
      const confirmJson = await confirm.json()
      expect(confirmJson.imported.outings, `outings imported for ${fixturePath}`).toBeGreaterThan(0)
      expect(confirmJson.imported.observations, `observations imported for ${fixturePath}`).toBeGreaterThan(0)
    }

    const dataAll = await api.get('/api/data/all', {
      headers: { cookie: authCookie },
    })
    expect(dataAll.status()).toBe(200)
    const dataAllJson = await dataAll.json()
    expect(dataAllJson.outings.length).toBeGreaterThan(0)
    expect(dataAllJson.observations.length).toBeGreaterThan(0)
    expect(dataAllJson.dex.length).toBeGreaterThan(0)

    await api.dispose()
  })

  test('re-import preview marks rows as duplicate conflicts', async () => {
    const api = await request.newContext({ baseURL: API_BASE })

    const signIn = await api.post('/api/auth/sign-in/anonymous', { data: {} })
    expect(signIn.status()).toBe(200)

    const authCookie = buildCookieHeader(
      signIn
        .headersArray()
        .filter(header => header.name.toLowerCase() === 'set-cookie')
        .map(header => header.value),
    )
    expect(authCookie).toBeTruthy()

    const csvBuffer = readFileSync(path.resolve('e2e/fixtures/ebird-import.csv'))

    const firstPreview = await api.post('/api/import/ebird-csv', {
      headers: { cookie: authCookie },
      multipart: {
        file: {
          name: 'ebird-import.csv',
          mimeType: 'text/csv',
          buffer: csvBuffer,
        },
      },
    })
    expect(firstPreview.status()).toBe(200)
    const firstPreviewJson = await firstPreview.json()

    const firstPreviewIds = firstPreviewJson.previews
      .map((entry: { previewId?: string }) => entry.previewId)
      .filter((id: string | undefined): id is string => !!id)
    expect(firstPreviewIds.length).toBeGreaterThan(0)

    const firstConfirm = await api.post('/api/import/ebird-csv/confirm', {
      headers: { cookie: authCookie },
      data: { previewIds: firstPreviewIds },
    })
    expect(firstConfirm.status()).toBe(200)

    const secondPreview = await api.post('/api/import/ebird-csv', {
      headers: { cookie: authCookie },
      multipart: {
        file: {
          name: 'ebird-import.csv',
          mimeType: 'text/csv',
          buffer: csvBuffer,
        },
      },
    })

    expect(secondPreview.status()).toBe(200)
    const secondPreviewJson = await secondPreview.json()
    expect(Array.isArray(secondPreviewJson.previews)).toBe(true)
    expect(secondPreviewJson.previews.length).toBeGreaterThan(0)

    const conflictTypes = new Set(
      secondPreviewJson.previews
        .map((entry: { conflict?: string }) => entry.conflict)
        .filter((conflict: string | undefined): conflict is string => !!conflict)
    )

    expect(conflictTypes.size).toBe(1)
    expect(conflictTypes.has('duplicate')).toBe(true)

    await api.dispose()
  })
})
