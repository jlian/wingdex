import { HttpError, suggestLocationName } from '../lib/bird-id'
import { RateLimitError, enforceAiDailyLimit } from '../lib/ai-rate-limit'

type SuggestLocationBody = {
  lat?: number
  lon?: number
  existingNames?: string[]
  prompt?: string
}

export const onRequestPost: PagesFunction<Env> = async context => {
  try {
    const userId = (context.data as { user?: { id?: string } }).user?.id
    if (!userId) {
      return new Response('Unauthorized', { status: 401 })
    }

    await enforceAiDailyLimit(context.env.DB, userId, 'suggest-location', context.env.AI_DAILY_LIMIT_SUGGEST)

    const body = await context.request.json() as SuggestLocationBody

    const result = await suggestLocationName(context.env, {
      lat: body.lat,
      lon: body.lon,
      existingNames: Array.isArray(body.existingNames) ? body.existingNames : undefined,
      prompt: body.prompt,
    })

    return Response.json(result)
  } catch (error) {
    if (error instanceof RateLimitError) {
      return new Response(error.message, {
        status: error.status,
        headers: {
          'Retry-After': String(error.retryAfterSeconds),
        },
      })
    }

    if (error instanceof HttpError) {
      return new Response(error.message, { status: error.status })
    }

    const message = error instanceof Error ? error.message : 'Location suggestion failed'
    return new Response(message, { status: 500 })
  }
}
