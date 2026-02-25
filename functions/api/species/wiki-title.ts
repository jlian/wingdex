import { getWikiMetadata } from '../../lib/taxonomy'

export const onRequestGet: PagesFunction<Env> = async context => {
  const name = new URL(context.request.url).searchParams.get('name')

  if (!name?.trim()) {
    return Response.json({ wikiTitle: null, common: null, scientific: null, thumbnailUrl: null })
  }

  const metadata = getWikiMetadata(name)

  return Response.json({
    wikiTitle: metadata.wikiTitle || null,
    common: metadata.common || null,
    scientific: metadata.scientific || null,
    thumbnailUrl: metadata.thumbnailUrl || null,
  })
}
