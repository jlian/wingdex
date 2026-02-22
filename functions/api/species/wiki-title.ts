import { findBestMatch, getWikiTitle } from '../../lib/taxonomy'

export const onRequestGet: PagesFunction<Env> = async context => {
  const name = new URL(context.request.url).searchParams.get('name')

  if (!name?.trim()) {
    return Response.json({ wikiTitle: null, common: null, scientific: null })
  }

  const match = findBestMatch(name)
  const resolvedCommon = match?.common || name
  const wikiTitle = getWikiTitle(resolvedCommon)

  return Response.json({
    wikiTitle: wikiTitle || null,
    common: match?.common || null,
    scientific: match?.scientific || null,
  })
}
