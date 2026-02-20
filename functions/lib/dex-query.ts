type DexRow = {
  speciesName: string
  firstSeenDate: string
  lastSeenDate: string
  addedDate?: string | null
  totalOutings: number
  totalCount: number
  bestPhotoId?: string | null
  notes: string
}

const DEX_QUERY = `
  SELECT
    obs.speciesName AS speciesName,
    MIN(o.startTime) AS firstSeenDate,
    MAX(o.startTime) AS lastSeenDate,
    dm.addedDate AS addedDate,
    COUNT(DISTINCT obs.outingId) AS totalOutings,
    SUM(obs.count) AS totalCount,
    dm.bestPhotoId AS bestPhotoId,
    COALESCE(dm.notes, '') AS notes
  FROM observation obs
  JOIN outing o ON obs.outingId = o.id
  LEFT JOIN dex_meta dm ON dm.userId = obs.userId AND dm.speciesName = obs.speciesName
  WHERE obs.userId = ?1 AND obs.certainty = 'confirmed'
  GROUP BY obs.speciesName
  ORDER BY obs.speciesName
`

export async function computeDex(db: D1Database, userId: string): Promise<DexRow[]> {
  const result = await db.prepare(DEX_QUERY).bind(userId).all<DexRow>()
  return result.results
}
