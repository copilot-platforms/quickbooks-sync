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
} from '@test/helpers/seed'
import { setupInvoiceVoidedTest } from '@test/helpers/invoiceVoidedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.voided (invoice already paid)', () => {
  const apis = setupInvoiceVoidedTest()

  it('leaves the invoice untouched and voids nothing when the sync row is not open', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    // Already paid — only OPEN invoices can be voided.
    await seedQBInvoiceSync({
      customerId: customer.id,
      status: InvoiceStatus.PAID,
    })
    await seedInvoiceCreatedLog()

    const res = await postWebhook(invoiceVoidedPayload)
    expect(res.status).toBe(200)

    // The event is claimed but the void is skipped, so the log stays pending.
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
    expect(voidedLogs[0].status).toBe(LogStatus.PENDING)
    // The claim row has no QBO id, and the skipped void never sets one.
    expect(voidedLogs[0].quickbooksId).toBeNull()

    // Sync row status is unchanged and nothing was voided in QBO.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.PAID)
    expect(apis.intuit.voidInvoice).not.toHaveBeenCalled()
  })
})
