import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import path from 'node:path'
import { databaseUrl } from '@/config'
import { migratePerFile } from '@/db/migratePerFile'

/**
 * Production/dev migration runner. Replaces `drizzle-kit migrate` in
 * `scripts/build.sh` — the drizzle-kit CLI batches every pending migration
 * into one transaction (same underlying `drizzle-orm` migrator), which
 * breaks whenever an enum-add migration and a later migration that
 * references the new value are both pending in the same run. `migratePerFile`
 * applies one migration per transaction instead; see that module for why.
 *
 * command to run: `yarn db:migrate`
 */

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'src/db/migrations')

;(async function run() {
  if (!databaseUrl) {
    console.error('migrate | DATABASE_URL is not set')
    process.exit(1)
  }

  const client = postgres(databaseUrl, { max: 1, prepare: false })
  try {
    console.info('migrate | Applying pending migrations...')
    await migratePerFile(drizzle(client), MIGRATIONS_FOLDER)
    console.info('migrate | Migrations applied successfully')
  } catch (error) {
    console.error('migrate | Migration failed', error)
    await client.end()
    process.exit(1)
  }

  await client.end()
  process.exit(0)
})()
