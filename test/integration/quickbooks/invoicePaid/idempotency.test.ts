import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { invoicePaidPayload } from '@test/fixtures/invoicePaid.webhook'
import {
  seedHealthyPortal,
  TEST_PORTAL_ID,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
  TEST_QB_PAYMENT_ID,
} from '@test/helpers/seed'
import { setupInvoicePaidTest } from '@test/helpers/invoicePaidTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.paid (same webhook delivered twice)', () => {
  const apis = setupInvoicePaidTest()

  it('processes the payment only once when a paid log for the invoice already exists', async () => {
    // The claim conflict short-circuits the handler before any invoice or
    // customer lookup, so only the portal (for auth) and the existing PAID log
    // are needed.
    await seedHealthyPortal()

    // Simulate a prior successful delivery that already claimed and processed
    // this invoice's payment.
    await db.insert(QBSyncLog).values({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.PAID,
      status: LogStatus.SUCCESS,
      copilotId: TEST_COPILOT_INVOICE_ID,
      invoiceNumber: TEST_INVOICE_NUMBER,
      quickbooksId: TEST_QB_PAYMENT_ID,
      amount: '60000.00',
    })

    const res = await postWebhook(invoicePaidPayload)
    expect(res.status).toBe(200)

    // No new PAID row inserted and the existing one is untouched.
    const paidLogs = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID),
          eq(QBSyncLog.eventType, EventType.PAID),
        ),
      )
    expect(paidLogs).toHaveLength(1)
    expect(paidLogs[0].status).toBe(LogStatus.SUCCESS)

    expect(apis.intuit.createPayment).not.toHaveBeenCalled()
  })
})
