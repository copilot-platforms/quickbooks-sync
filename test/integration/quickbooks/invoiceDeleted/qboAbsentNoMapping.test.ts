import { describe, it, expect, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { EventType, LogStatus } from '@/app/api/core/types/log'

import { invoiceDeletedPayload } from '@test/fixtures/invoiceDeleted.webhook'
import {
  seedHealthyPortal,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceDeletedTest } from '@test/helpers/invoiceDeletedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.deleted (never synced, also gone from QuickBooks)', () => {
  const apis = setupInvoiceDeletedTest(() => ({
    intuit: createMockIntuitAPI({
      getInvoice: vi.fn().mockResolvedValue(null),
    }),
  }))

  it('records a soft-deleted SUCCESS log and touches nothing when there is no mapping or QBO invoice', async () => {
    await seedHealthyPortal()
    // No invoice sync row and nothing in QBO — nothing to delete anywhere.

    const res = await postWebhook(invoiceDeletedPayload)
    expect(res.status).toBe(200)

    expect(apis.intuit.getInvoice).toHaveBeenCalledTimes(1)
    expect(apis.intuit.deleteInvoice).not.toHaveBeenCalled()

    // No sync row was created.
    const invoiceSyncRows = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSyncRows).toHaveLength(0)

    // DELETED event recorded for audit, amount from the payload.
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
    // This path records neither a QuickBooks id nor tax.
    expect(successLog?.quickbooksId).toBeNull()
    expect(successLog?.taxAmount).toBeNull()
  })
})
