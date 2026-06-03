import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import { seedHealthyPortal } from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (lazy item creation for an unmapped product)', () => {
  // Unmapped product → create-new-item branch; getAnItem returns undefined.
  const apis = setupInvoiceCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      getAnItem: vi.fn().mockResolvedValue(undefined),
      createItem: vi.fn().mockResolvedValue({
        Id: '1234',
        Name: 'Test Product',
        SyncToken: '0',
      }),
    }),
  }))

  it('creates exactly one item with the un-suffixed product name and one mapping row', async () => {
    // createNewProductFlag is true in the default healthy portal setting.
    await seedHealthyPortal()
    // No seedProductSync -> product is unmapped.

    const res = await postWebhook(invoiceCreatedPayload)
    expect(res.status).toBe(200)

    // Invoice flow also creates the one-off "Assembly Service" item; assert
    // on the product item (un-suffixed name).
    const productItemCall = apis.intuit.createItem.mock.calls.find(
      (call) => call[0]?.Name === 'Test Product',
    )
    expect(productItemCall).toBeDefined()

    const rows = await db
      .select()
      .from(QBProductSync)
      .where(
        eq(
          QBProductSync.productId,
          invoiceCreatedPayload.data.lineItems[0].productId,
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0].qbItemId).toBe('1234')
  })
})
