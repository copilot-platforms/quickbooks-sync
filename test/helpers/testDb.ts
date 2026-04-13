import { sql } from 'drizzle-orm'
import { db } from '@/db'

/**
 * Wipes every table in the schema that integration tests can touch. Call in
 * `beforeEach` — the testcontainer Postgres is shared across the full
 * integration run, so cross-test contamination is a real risk.
 *
 * If a new table is added to `src/db/schema/*.ts`, add it here too. The
 * consequence of forgetting is silent cross-test contamination — tests pass
 * in isolation but fail in full-suite runs depending on file order.
 */
export async function truncateAllTestTables() {
  await db.execute(sql`
    TRUNCATE TABLE
      qb_sync_logs,
      qb_connection_logs,
      qb_customers,
      qb_invoice_sync,
      qb_payment_sync,
      qb_product_sync,
      qb_settings,
      qb_portal_connections
    RESTART IDENTITY CASCADE
  `)
}
