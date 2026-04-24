import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Vitest globalSetup for integration tests.
 *
 * Responsibilities:
 * - Start an ephemeral Postgres container via testcontainers
 * - Set process.env.DATABASE_URL before any test worker imports src/config
 * - Apply all Drizzle migrations from src/db/migrations to the fresh DB
 * - Stub any src/config env vars that must be non-empty at import time
 * - Stop the container on teardown
 *
 * Env var propagation: Vitest spawns worker processes AFTER globalSetup resolves,
 * so process.env set here is inherited by workers. Combined with `pool: 'forks'`
 * and `fileParallelism: false` in vitest.config.ts, this gives us one container
 * shared across all integration test files.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../src/db/migrations')
const ENV_TEST_FILE = path.resolve(__dirname, '../../.env.test')

let container: StartedPostgreSqlContainer | undefined

export default async function globalSetup() {
  // Load .env.test into process.env BEFORE anything else. `override: true`
  // ensures the developer's local `.env` doesn't leak into test runs.
  // DATABASE_URL is intentionally not in .env.test — we set it below from the
  // testcontainer's dynamic connection URI.
  dotenv.config({ path: ENV_TEST_FILE, override: true })

  console.info('[globalSetup] Starting Postgres test container...')

  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test_db')
    .withUsername('test_user')
    .withPassword('test_pass')
    .start()

  const url = container.getConnectionUri()
  process.env.DATABASE_URL = url

  console.info('[globalSetup] Running Drizzle migrations...')
  const migrationClient = postgres(url, { max: 1, prepare: false })
  const migrationDb = drizzle(migrationClient)
  try {
    await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await migrationClient.end()
  }

  console.info(`[globalSetup] Ready: ${url}`)

  return async () => {
    console.info('[globalSetup] Stopping Postgres test container...')
    await container?.stop()
  }
}
