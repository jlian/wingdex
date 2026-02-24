/**
 * Schema-capability helpers for graceful migration gating.
 *
 * Cloudflare D1 (SQLite) doesn't support IF NOT EXISTS on ALTER TABLE,
 * so endpoints probe PRAGMA table_info to decide whether newer columns
 * are available before referencing them in queries.
 */

export async function getTableColumnNames(db: D1Database, table: string): Promise<Set<string>> {
  const info = await db.prepare(`PRAGMA table_info('${table}')`).all<{ name: string }>()
  return new Set(info.results.map(column => column.name))
}

export async function getOutingColumnNames(db: D1Database): Promise<Set<string>> {
  return getTableColumnNames(db, 'outing')
}

export async function hasObservationColumn(db: D1Database, column: string): Promise<boolean> {
  const names = await getTableColumnNames(db, 'observation')
  return names.has(column)
}
