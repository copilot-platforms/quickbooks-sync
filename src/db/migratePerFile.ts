import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

type Journal = {
  version: string
  dialect: string
  entries: { idx: number; when: number; tag: string; breakpoints: boolean }[]
}

/**
 * Applies each migration in its own transaction, not batched.
 *
 * drizzle's `migrate()` runs all pending files in one transaction, which
 * breaks when one adds an enum value and a later one uses it (Postgres:
 * "unsafe use of new value"). Replaying per journal entry commits one file
 * at a time. Used by both globalSetup and the prod runner (src/db/migrate.ts).
 */
export async function migratePerFile<TSchema extends Record<string, unknown>>(
  db: PostgresJsDatabase<TSchema>,
  migrationsFolder: string,
): Promise<void> {
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf-8'),
  ) as Journal

  const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-migrate-'))
  fs.mkdirSync(path.join(tempFolder, 'meta'))
  for (const entry of journal.entries) {
    fs.copyFileSync(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      path.join(tempFolder, `${entry.tag}.sql`),
    )
  }

  try {
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
  }
}
