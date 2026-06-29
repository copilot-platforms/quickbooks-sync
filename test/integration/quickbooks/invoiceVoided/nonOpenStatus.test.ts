import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import {
  EventType,
  FailedRecordCategoryType,
  LogStatus,
} from '@/app/api/core/types/log'
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

  it('records a non-retryable FAILED log and voids nothing when the sync row is paid, not open', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    // Paid invoices can't be voided and never become OPEN again — terminal.
    await seedQBInvoiceSync({
      customerId: customer.id,
      status: InvoiceStatus.PAID,
    })
    await seedInvoiceCreatedLog()

    const res = await postWebhook(invoiceVoidedPayload)
    expect(res.status).toBe(200)

    // Finalized as a FAILED log with a message — never a stale PENDING claim
    // the reaper flips into a message-less, retryable row (OUT-3867).
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
    expect(voidedLogs[0].status).toBe(LogStatus.FAILED)
    // Non-retryable so the resync cron never picks it up — no 25-retry storm.
    expect(voidedLogs[0].shouldRetry).toBe(false)
    expect(voidedLogs[0].category).toBe(FailedRecordCategoryType.VALIDATION)
    expect(voidedLogs[0].errorMessage).toContain('non-open invoice (status=')

    // Sync row status is unchanged and nothing was voided in QBO.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.PAID)
    expect(apis.intuit.voidInvoice).not.toHaveBeenCalled()
  })
})
