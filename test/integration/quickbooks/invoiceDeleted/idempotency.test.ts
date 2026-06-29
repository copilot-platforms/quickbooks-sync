import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { invoiceDeletedPayload } from '@test/fixtures/invoiceDeleted.webhook'
import {
  seedHealthyPortal,
  TEST_PORTAL_ID,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
  TEST_QB_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoiceDeletedTest } from '@test/helpers/invoiceDeletedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.deleted (same webhook delivered twice)', () => {
  const apis = setupInvoiceDeletedTest()

  it('processes the delete only once when a deleted log for the invoice already exists', async () => {
    // The claim conflict short-circuits early; only portal + DELETED log are needed.
    await seedHealthyPortal()

    // Simulate a prior successful delivery of this invoice's delete.
    await db.insert(QBSyncLog).values({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.DELETED,
      status: LogStatus.SUCCESS,
      copilotId: TEST_COPILOT_INVOICE_ID,
      invoiceNumber: TEST_INVOICE_NUMBER,
      quickbooksId: TEST_QB_INVOICE_ID,
      amount: '60000.00',
      taxAmount: '0.00',
    })

    const res = await postWebhook(invoiceDeletedPayload)
    expect(res.status).toBe(200)

    // No new DELETED row inserted and the existing one is untouched.
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
    expect(deletedLogs[0].status).toBe(LogStatus.SUCCESS)

    // The claim conflicts before any QBO work happens.
    expect(apis.intuit.getInvoice).not.toHaveBeenCalled()
    expect(apis.intuit.deleteInvoice).not.toHaveBeenCalled()
  })
})
