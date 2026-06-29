import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { EventType, LogStatus } from '@/app/api/core/types/log'
import { InvoiceStatus } from '@/app/api/core/types/invoice'

import { invoiceVoidedPayload } from '@test/fixtures/invoiceVoided.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  seedInvoiceCreatedLog,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
  TEST_QB_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoiceVoidedTest } from '@test/helpers/invoiceVoidedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.voided (sync row already void)', () => {
  const apis = setupInvoiceVoidedTest()

  it('finalizes the voided log as SUCCESS without re-voiding when the sync row is already void', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    // Mapping already VOID with no terminal log to dedupe the claim — voiding
    // again is an idempotent no-op that should finalize the log, not leave it PENDING.
    await seedQBInvoiceSync({
      customerId: customer.id,
      status: InvoiceStatus.VOID,
    })
    await seedInvoiceCreatedLog()

    const res = await postWebhook(invoiceVoidedPayload)
    expect(res.status).toBe(200)

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
    expect(voidedLogs[0].quickbooksId).toBe(TEST_QB_INVOICE_ID)

    // Already void in QBO — nothing re-voided.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.VOID)
    expect(apis.intuit.voidInvoice).not.toHaveBeenCalled()
  })
})
