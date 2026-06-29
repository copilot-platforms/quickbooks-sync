import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { InvoiceStatus } from '@/app/api/core/types/invoice'

import { invoiceVoidedPayload } from '@test/fixtures/invoiceVoided.webhook'
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
import { setupInvoiceVoidedTest } from '@test/helpers/invoiceVoidedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.voided (invoice voided in QuickBooks)', () => {
  const apis = setupInvoiceVoidedTest()

  it('voids the QuickBooks invoice, marks the sync row void, and logs the sync as successful', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({ customerId: customer.id })
    // Non-zero tax so a dropped or mis-scaled tax column would fail the check.
    await seedInvoiceCreatedLog({ taxAmount: '4200.00' })

    const res = await postWebhook(invoiceVoidedPayload)
    expect(res.status).toBe(200)

    // For voided, quickbooks_id holds the QBO Invoice id.
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
    expect(voidedLogs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.VOIDED,
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

    // Invoice sync row flipped to void.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.VOID)

    // Voided once, with the mapped invoice id + sync token.
    expect(apis.intuit.voidInvoice).toHaveBeenCalledTimes(1)
    const [voidPayload] = apis.intuit.voidInvoice.mock.calls[0]
    expect(voidPayload).toMatchObject({
      Id: TEST_QB_INVOICE_ID,
      SyncToken: '0',
    })
  })
})
