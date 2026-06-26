import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { TransactionType } from '@/type/common'

import { invoicePaidPayload } from '@test/fixtures/invoicePaid.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  seedInvoiceCreatedLog,
  TEST_PORTAL_ID,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
  TEST_QB_CUSTOMER_ID,
  TEST_QB_INVOICE_ID,
  TEST_QB_PAYMENT_ID,
} from '@test/helpers/seed'
import { setupInvoicePaidTest } from '@test/helpers/invoicePaidTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.paid (payment recorded in QuickBooks)', () => {
  const apis = setupInvoicePaidTest()

  it('creates a QuickBooks payment, logs the sync as successful, and marks the invoice paid', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({ customerId: customer.id })
    await seedInvoiceCreatedLog()

    const res = await postWebhook(invoicePaidPayload)
    expect(res.status).toBe(200)

    // For (invoice, paid) the polymorphic `quickbooks_id` column holds the QBO
    // Payment id, not the invoice id. See memory/project_qb_sync_logs_semantics.md.
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
    expect(paidLogs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.PAID,
      status: LogStatus.SUCCESS,
      copilotId: TEST_COPILOT_INVOICE_ID,
      quickbooksId: TEST_QB_PAYMENT_ID,
      invoiceNumber: TEST_INVOICE_NUMBER,
      amount: '60000.00',
    })

    // Invoice sync row flipped to paid.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.PAID)

    // Payment created once, linked to the invoice for the full amount.
    expect(apis.intuit.createPayment).toHaveBeenCalledTimes(1)
    const [paymentPayload] = apis.intuit.createPayment.mock.calls[0]
    expect(paymentPayload).toMatchObject({
      TotalAmt: 600,
      CustomerRef: { value: TEST_QB_CUSTOMER_ID },
    })
    expect(paymentPayload.Line[0]).toMatchObject({
      Amount: 600,
      LinkedTxn: [
        { TxnId: TEST_QB_INVOICE_ID, TxnType: TransactionType.INVOICE },
      ],
    })
  })
})
