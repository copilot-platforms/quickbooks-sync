import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import productCreatedPayload from '@test/fixtures/productCreated.webhook'
import { seedHealthyPortal, TEST_PORTAL_ID } from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupProductCreatedTest } from '@test/helpers/productCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

// createItem fails inside the tx → rollback (no row), but the handler's catch
// writes a FAILED sync log outside the tx.
describe('POST /api/quickbooks/webhook — product.created (QB createItem fails)', () => {
  const apis = setupProductCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      createItem: vi.fn().mockRejectedValue(new Error('QuickBooks is on fire')),
    }),
  }))

  it('rolls back the tx, inserts no mapping row, and writes a FAILED sync log', async () => {
    await seedHealthyPortal()

    const res = await postWebhook(productCreatedPayload)
    // Error is swallowed (ok:true); failure shows only in qb_sync_logs.
    expect(res.status).toBe(200)

    // Got far enough to attempt item creation.
    expect(apis.intuit.createItem).toHaveBeenCalledTimes(1)

    // Tx rolled back — no mapping row.
    const productRows = await db.select().from(QBProductSync)
    expect(productRows).toHaveLength(0)

    // FAILED log written outside the tx.
    const failedLogs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, productCreatedPayload.data.id))

    expect(failedLogs).toHaveLength(1)
    expect(failedLogs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.PRODUCT,
      eventType: EventType.CREATED,
      status: LogStatus.FAILED,
      copilotId: productCreatedPayload.data.id,
    })
    expect(failedLogs[0].errorMessage).toContain('QuickBooks is on fire')
  })
})
