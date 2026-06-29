import { describe, it, expect, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { EventType, LogStatus } from '@/app/api/core/types/log'
import { InvoiceStatus } from '@/app/api/core/types/invoice'

import { invoiceDeletedPayload } from '@test/fixtures/invoiceDeleted.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  seedInvoiceCreatedLog,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceDeletedTest } from '@test/helpers/invoiceDeletedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.deleted (invoice already gone from QuickBooks)', () => {
  // QBO has no such invoice (never synced or deleted there directly).
  const apis = setupInvoiceDeletedTest(() => ({
    intuit: createMockIntuitAPI({
      getInvoice: vi.fn().mockResolvedValue(null),
    }),
  }))

  it('soft-deletes prior logs and marks the mapping deleted without calling QuickBooks', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({
      customerId: customer.id,
      status: InvoiceStatus.VOID,
    })
    await seedInvoiceCreatedLog()

    const res = await postWebhook(invoiceDeletedPayload)
    expect(res.status).toBe(200)

    // QBO was checked, but there was nothing to delete there.
    expect(apis.intuit.getInvoice).toHaveBeenCalledTimes(1)
    expect(apis.intuit.deleteInvoice).not.toHaveBeenCalled()

    // Local mapping marked deleted.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.DELETED)

    // A SUCCESS DELETED log is recorded for audit, already soft-deleted.
    const deletedLogs = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID),
          eq(QBSyncLog.eventType, EventType.DELETED),
        ),
      )
    const successLog = deletedLogs.find((l) => l.status === LogStatus.SUCCESS)
    expect(successLog).toBeDefined()
    expect(successLog?.deletedAt).not.toBeNull()
    expect(successLog?.amount).toBe('60000.00')
    // No QBO delete happened, so no QuickBooks id is recorded.
    expect(successLog?.quickbooksId).toBeNull()

    // The prior CREATED log was soft-deleted too.
    const [createdLog] = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID),
          eq(QBSyncLog.eventType, EventType.CREATED),
        ),
      )
    expect(createdLog.deletedAt).not.toBeNull()
  })
})
