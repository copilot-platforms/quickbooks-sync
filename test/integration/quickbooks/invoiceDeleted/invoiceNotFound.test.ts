import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { invoiceDeletedPayload } from '@test/fixtures/invoiceDeleted.webhook'
import { seedHealthyPortal, TEST_COPILOT_INVOICE_ID } from '@test/helpers/seed'
import { setupInvoiceDeletedTest } from '@test/helpers/invoiceDeletedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.deleted (in QuickBooks but never synced locally)', () => {
  const apis = setupInvoiceDeletedTest()

  it('records a FAILED deleted log and deletes nothing when the invoice is missing from the sync table', async () => {
    await seedHealthyPortal()
    // QBO has the invoice (default mock) but there is no local mapping.

    const res = await postWebhook(invoiceDeletedPayload)
    expect(res.status).toBe(200)

    const deletedLogs = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID),
          eq(QBSyncLog.eventType, EventType.DELETED),
        ),
      )
    expect(deletedLogs).toHaveLength(1)
    expect(deletedLogs[0]).toMatchObject({
      entityType: EntityType.INVOICE,
      eventType: EventType.DELETED,
      status: LogStatus.FAILED,
    })
    expect(deletedLogs[0].errorMessage).toContain(
      'Invoice not found in sync table',
    )

    // QBO was checked, but the missing local mapping stopped the delete.
    expect(apis.intuit.getInvoice).toHaveBeenCalledTimes(1)
    expect(apis.intuit.deleteInvoice).not.toHaveBeenCalled()
  })
})
