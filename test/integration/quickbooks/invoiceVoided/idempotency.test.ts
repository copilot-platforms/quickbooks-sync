import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { invoiceVoidedPayload } from '@test/fixtures/invoiceVoided.webhook'
import {
  seedHealthyPortal,
  TEST_PORTAL_ID,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
  TEST_QB_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoiceVoidedTest } from '@test/helpers/invoiceVoidedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.voided (same webhook delivered twice)', () => {
  const apis = setupInvoiceVoidedTest()

  it('processes the void only once when a voided log for the invoice already exists', async () => {
    // The claim conflict short-circuits early; only portal + VOIDED log are needed.
    await seedHealthyPortal()

    // Simulate a prior successful delivery of this invoice's void.
    await db.insert(QBSyncLog).values({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.VOIDED,
      status: LogStatus.SUCCESS,
      copilotId: TEST_COPILOT_INVOICE_ID,
      invoiceNumber: TEST_INVOICE_NUMBER,
      quickbooksId: TEST_QB_INVOICE_ID,
      amount: '60000.00',
      taxAmount: '0.00',
    })

    const res = await postWebhook(invoiceVoidedPayload)
    expect(res.status).toBe(200)

    // No new VOIDED row inserted and the existing one is untouched.
    const voidedLogs = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID),
          eq(QBSyncLog.eventType, EventType.VOIDED),
        ),
      )
    expect(voidedLogs).toHaveLength(1)
    expect(voidedLogs[0].status).toBe(LogStatus.SUCCESS)

    expect(apis.intuit.voidInvoice).not.toHaveBeenCalled()
  })
})
