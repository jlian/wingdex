// D1 allows at most 100 bound parameters per query. Lookups that bind one
// parameter per ID (plus any fixed leading params such as userId) must split
// large user-controlled ID lists into chunks to avoid exceeding that limit.
// https://developers.cloudflare.com/d1/platform/limits/

// Keep a safe margin below D1's 100-parameter ceiling to leave room for a
// leading fixed parameter (e.g. userId) in the same query.
const MAX_IDS_PER_QUERY = 90

export function chunkIds<T>(ids: T[], size: number = MAX_IDS_PER_QUERY): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1')
  const chunks: T[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}

// Runs an IN(...) lookup over `ids` in D1-safe chunks and concatenates the
// per-chunk rows. `runChunk` receives a chunk plus its comma-joined `?`
// placeholders and returns that chunk's rows.
export async function queryInChunks<Id, Row>(
  ids: Id[],
  runChunk: (chunk: Id[], placeholders: string) => Promise<Row[]>,
  size: number = MAX_IDS_PER_QUERY,
): Promise<Row[]> {
  const rows: Row[] = []
  for (const chunk of chunkIds(ids, size)) {
    const placeholders = chunk.map(() => '?').join(', ')
    rows.push(...(await runChunk(chunk, placeholders)))
  }
  return rows
}
