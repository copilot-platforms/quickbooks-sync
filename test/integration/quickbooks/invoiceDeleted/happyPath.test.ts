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
  seedInvoiceCreatedLog,
  TEST_PORTAL_ID,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
  TEST_QB_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoiceDeletedTest } from '@test/helpers/invoiceDeletedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.deleted (invoice deleted in QuickBooks)', () => {
  const apis = setupInvoiceDeletedTest()

  it('deletes the QuickBooks invoice, marks the sync row deleted, and logs the sync as successful', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    // Copilot only fires delete on voided invoices. qbSyncToken differs from
    // the mock's SyncToken to prove the delete reads the DB token, not QBO's.
    await seedQBInvoiceSync({
      customerId: customer.id,
      status: InvoiceStatus.VOID,
      qbSyncToken: '3',
    })
    // Non-zero tax so a dropped or mis-scaled tax column would fail the check.
    await seedInvoiceCreatedLog({ taxAmount: '4200.00' })

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
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.DELETED,
      status: LogStatus.SUCCESS,
      copilotId: TEST_COPILOT_INVOICE_ID,
      quickbooksId: TEST_QB_INVOICE_ID,
      invoiceNumber: TEST_INVOICE_NUMBER,
      // amount/taxAmount are carried over from the CREATED log.
      amount: '60000.00',
      taxAmount: '4200.00',
      // customerName/email come from the getClient mock.
      customerName: 'Jane Doe',
      customerEmail: 'jane@example.com',
    })

    // Invoice sync row flipped to deleted.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.DELETED)

    // QBO checked for the invoice, then deleted once with the mapped id + token.
    expect(apis.intuit.getInvoice).toHaveBeenCalledTimes(1)
    expect(apis.intuit.deleteInvoice).toHaveBeenCalledTimes(1)
    const [deletePayload] = apis.intuit.deleteInvoice.mock.calls[0]
    expect(deletePayload).toMatchObject({
      Id: TEST_QB_INVOICE_ID,
      SyncToken: '3',
    })
  })
})
