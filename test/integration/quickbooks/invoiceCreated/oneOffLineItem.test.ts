import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import { seedHealthyPortal } from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

/**
 * Line item without productId/priceId routes through the Assembly Service
 * one-off item. copilot.getProduct is never called; createInvoice is invoked
 * with ItemRef pointing at the service item Id (not '999').
 */
describe('POST /api/quickbooks/webhook — invoice.created (one-off line item)', () => {
  const apis = setupInvoiceCreatedTest()

  it('uses Assembly Service ref when line item has no productId/priceId', async () => {
    await seedHealthyPortal()

    const oneOffPayload = {
      ...invoiceCreatedPayload,
      data: {
        ...invoiceCreatedPayload.data,
        lineItems: [
          {
            amount: 5000,
            quantity: 1,
            description: 'Ad-hoc consulting',
          },
        ],
      },
    }
    const res = await postWebhook(oneOffPayload)
    expect(res.status).toBe(200)

    // Service item path, not product mapping
    expect(apis.copilot.getProduct).not.toHaveBeenCalled()
    expect(apis.intuit.getAnItem).toHaveBeenCalledWith('Assembly Service')

    // Invoice still created
    expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(1)

    // Persisted
    expect(await db.select().from(QBInvoiceSync)).toHaveLength(1)
  })
})
