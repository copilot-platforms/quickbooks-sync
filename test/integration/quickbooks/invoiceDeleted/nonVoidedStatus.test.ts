import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { InvoiceStatus } from '@/app/api/core/types/invoice'

import { invoiceDeletedPayload } from '@test/fixtures/invoiceDeleted.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoiceDeletedTest } from '@test/helpers/invoiceDeletedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.deleted (invoice not voided first)', () => {
  const apis = setupInvoiceDeletedTest()

  it('records a FAILED deleted log and deletes nothing when the sync row is not voided', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    // Still open — Copilot should only fire delete on voided invoices.
    await seedQBInvoiceSync({
      customerId: customer.id,
      status: InvoiceStatus.OPEN,
    })

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
    expect(deletedLogs[0].errorMessage).toContain('non-voided record')

    // QBO is checked before the status guard, but nothing is deleted.
    expect(apis.intuit.getInvoice).toHaveBeenCalledTimes(1)
    expect(apis.intuit.deleteInvoice).not.toHaveBeenCalled()

    // Sync row status is unchanged.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.OPEN)
  })
})
