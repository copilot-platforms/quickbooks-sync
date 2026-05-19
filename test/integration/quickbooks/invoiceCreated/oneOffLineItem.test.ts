import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import { seedHealthyPortal } from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (line item not tied to a product or price)', () => {
  const apis = setupInvoiceCreatedTest()

  it('bills the line item under the generic "Assembly Service" item in QuickBooks', async () => {
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

    // No productId/priceId on the line item, so Copilot product lookup is
    // skipped and the line is billed as a generic service item.
    expect(apis.copilot.getProduct).not.toHaveBeenCalled()
    expect(apis.intuit.getAnItem).toHaveBeenCalledWith('Assembly Service')

    expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(1)
    expect(await db.select().from(QBInvoiceSync)).toHaveLength(1)
  })
})
