import { describe, it, expect, vi } from 'vitest'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import { seedHealthyPortal, seedProductSync } from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (UnitPrice comes from the line, not the stored mapping)', () => {
  // Mapped item must exist in QB, else it falls back to the one-off item.
  const apis = setupInvoiceCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      getAnItem: vi.fn().mockResolvedValue({
        Id: '999',
        Name: 'Test Product',
        SyncToken: '0',
        Active: true,
      }),
    }),
  }))

  it('bills the line at the line amount even when it differs from the mapped item price', async () => {
    await seedHealthyPortal()
    await seedProductSync() // qbItemId '999'

    const payload = {
      ...invoiceCreatedPayload,
      data: {
        ...invoiceCreatedPayload.data,
        lineItems: [
          {
            productId: invoiceCreatedPayload.data.lineItems[0].productId,
            priceId: invoiceCreatedPayload.data.lineItems[0].priceId,
            amount: 12345, // cents; deliberately != 60000
            quantity: 2,
            description: 'Two units at a non-default price',
          },
        ],
      },
    }

    const res = await postWebhook(payload)
    expect(res.status).toBe(200)

    const [invoice] = apis.intuit.createInvoice.mock.calls[0]
    const line = invoice.Line[0]
    expect(line.SalesItemLineDetail.ItemRef).toEqual({ value: '999' })
    expect(line.SalesItemLineDetail.UnitPrice).toBe(123.45)
    expect(line.SalesItemLineDetail.Qty).toBe(2)
    expect(line.Amount).toBe(246.9)
  })
})
