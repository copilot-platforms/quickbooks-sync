import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import { seedHealthyPortal, seedProductSync, TEST_QB_INVOICE_ID } from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

/**
 * status='paid' triggers the inline payment-creation branch inside
 * webhookInvoiceCreated. createPayment is called and the qb_invoice_sync row
 * is written with status='paid'.
 */
describe('POST /api/quickbooks/webhook — invoice.created (status=paid creates payment)', () => {
  const apis = setupInvoiceCreatedTest()

  it('creates the QB payment linked to the just-created invoice', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const paidPayload = {
      ...invoiceCreatedPayload,
      data: { ...invoiceCreatedPayload.data, status: 'paid' },
    }
    const res = await postWebhook(paidPayload)
    expect(res.status).toBe(200)

    // Invoice sync row stored with paid status
    const invoices = await db.select().from(QBInvoiceSync)
    expect(invoices).toHaveLength(1)
    expect(invoices[0].status).toBe('paid')

    // QB invoice + payment both created
    expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(1)
    expect(apis.intuit.createPayment).toHaveBeenCalledTimes(1)

    // Payment links to the just-created invoice
    const [paymentPayload] = apis.intuit.createPayment.mock.calls[0]
    expect(paymentPayload.Line[0].LinkedTxn[0]).toMatchObject({
      TxnId: TEST_QB_INVOICE_ID,
      TxnType: 'Invoice',
    })
  })
})
