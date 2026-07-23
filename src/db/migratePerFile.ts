import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'

type Journal = {
  version: string
  dialect: string
  entries: { idx: number; when: number; tag: string; breakpoints: boolean }[]
}

// Fixed key so concurrent runners serialize on one advisory lock.
const MIGRATION_ADVISORY_LOCK_KEY = 4030604

/**
 * Applies migrations one-per-transaction under a session advisory lock.
 *
 * Per-file commits avoid drizzle's batched `migrate()` "unsafe use of new
 * value" error (enum added, then used in a later file); the lock stops
 * concurrent runners racing the same pending migration. Used by globalSetup
 * and the prod runner (src/db/migrate.ts).
 */
export async function migratePerFile<TSchema extends Record<string, unknown>>(
  db: PostgresJsDatabase<TSchema>,
  migrationsFolder: string,
): Promise<void> {
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf-8'),
  ) as Journal

  await db.execute(sql`SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_KEY})`)

  const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-migrate-'))
  try {
    fs.mkdirSync(path.join(tempFolder, 'meta'))
    for (const entry of journal.entries) {
      fs.copyFileSync(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        path.join(tempFolder, `${entry.tag}.sql`),
      )
    }

    for (let i = 0; i < journal.entries.length; i++) {
      fs.writeFileSync(
        path.join(tempFolder, 'meta/_journal.json'),
        JSON.stringify({
          ...journal,
          entries: journal.entries.slice(0, i + 1),
        }),
      )
      await migrate(db, { migrationsFolder: tempFolder })
    }
  } finally {
    fs.rmSync(tempFolder, { recursive: true, force: true })
    await db.execute(
      sql`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_KEY})`,
    )
  }
}
