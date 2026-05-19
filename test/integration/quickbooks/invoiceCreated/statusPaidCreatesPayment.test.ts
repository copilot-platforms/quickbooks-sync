import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_QB_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (invoice arrives already paid)', () => {
  const apis = setupInvoiceCreatedTest()

  it('creates the invoice and immediately records the matching payment in QuickBooks', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const paidPayload = {
      ...invoiceCreatedPayload,
      data: { ...invoiceCreatedPayload.data, status: 'paid' },
    }
    const res = await postWebhook(paidPayload)
    expect(res.status).toBe(200)

    const invoices = await db.select().from(QBInvoiceSync)
    expect(invoices).toHaveLength(1)
    expect(invoices[0].status).toBe('paid')

    expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(1)
    expect(apis.intuit.createPayment).toHaveBeenCalledTimes(1)

    // The payment links back to the invoice we just created.
    const [paymentPayload] = apis.intuit.createPayment.mock.calls[0]
    expect(paymentPayload.Line[0].LinkedTxn[0]).toMatchObject({
      TxnId: TEST_QB_INVOICE_ID,
      TxnType: 'Invoice',
    })
  })
})
