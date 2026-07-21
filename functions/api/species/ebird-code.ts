import { getEbirdCode } from '../../lib/taxonomy'
import { createRouteResponder } from '../../lib/log'

export const onRequestGet: PagesFunction<Env> = async context => {
  const route = createRouteResponder(context.data.log, 'species/ebirdCode/read', 'Application')
  const userId = (context.data as { user?: { id?: string } }).user?.id
  if (!userId) {
    return route.fail(401, 'Unauthorized', 'eBird code lookup requires an authenticated session')
  }

  const name = new URL(context.request.url).searchParams.get('name') ?? ''
  const trimmed = name.trim()

  if (!trimmed) {
    return Response.json({ ebirdCode: null })
  }

  const ebirdCode = getEbirdCode(trimmed)
  return Response.json({ ebirdCode: ebirdCode || null })
}
