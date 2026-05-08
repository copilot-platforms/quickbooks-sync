import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBProductSync } from '@/db/schema/qbProductSync'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import { seedHealthyPortal } from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

/**
 * Pins the second createNewProductFlag check inside
 * InvoiceService#getInvoiceItemRef (line 252) — distinct from the
 * webhook-level gate that only fires for PRICE/PRODUCT events.
 *
 * Setup: line item has productId+priceId but no qb_product_sync mapping AND
 * createNewProductFlag=false. Expected: falls back to one-off Assembly
 * Service ref; no qb_product_sync row written; createItem is NOT invoked
 * for the unmapped product (it is called once for the Assembly Service
 * item ref, which is unrelated bookkeeping done by handleServiceItem).
 */
describe('POST /api/quickbooks/webhook — invoice.created (createNewProductFlag=false on unmapped item)', () => {
  const apis = setupInvoiceCreatedTest()

  it('uses one-off ref and writes no product mapping when flag is off', async () => {
    await seedHealthyPortal({ setting: { createNewProductFlag: false } })
    // intentionally no seedProductSync()

    const res = await postWebhook(invoiceCreatedPayload)
    expect(res.status).toBe(200)

    // copilot.getProduct IS called — flag check sits AFTER product resolution
    expect(apis.copilot.getProduct).toHaveBeenCalled()

    // Service item path is exercised: handleServiceItem looks up
    // 'Assembly Service' in QB. Mirrors oneOffLineItem.test.ts.
    expect(apis.intuit.getAnItem).toHaveBeenCalledWith('Assembly Service')

    // createItem may run once for the Assembly Service ref (handleServiceItem
    // → manageServiceItemRef → createItemInQB), but NEVER for the line-item
    // product. Asserting on the Name field is the strongest signal — '999'
    // collisions on Id make a count-based check fragile.
    const createItemNames = apis.intuit.createItem.mock.calls.map(
      ([payload]) => payload?.Name,
    )
    expect(createItemNames).not.toContain('Test Product')

    // No product mapping written — this is the flag-off invariant we care
    // about most. Even if the service item path changes, this row count
    // proves the flag-off short-circuit fired.
    expect(await db.select().from(QBProductSync)).toHaveLength(0)

    // Invoice still gets written.
    expect(await db.select().from(QBInvoiceSync)).toHaveLength(1)
  })
})
