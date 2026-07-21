import { getWikiMetadata } from '../../lib/taxonomy'
import { createRouteResponder } from '../../lib/log'

export const onRequestGet: PagesFunction<Env> = async context => {
  const route = createRouteResponder(context.data.log, 'species/wikiTitle/read', 'Application')
  const name = new URL(context.request.url).searchParams.get('name')

  if (!name?.trim()) {
    return Response.json({ wikiTitle: null, common: null, scientific: null, thumbnailUrl: null })
  }

  const metadata = getWikiMetadata(name)
  route.debug('Resolved wiki metadata', { hasWikiTitle: !!metadata.wikiTitle })

  return Response.json({
    wikiTitle: metadata.wikiTitle || null,
    common: metadata.common || null,
    scientific: metadata.scientific || null,
    thumbnailUrl: metadata.thumbnailUrl || null,
  })
}
