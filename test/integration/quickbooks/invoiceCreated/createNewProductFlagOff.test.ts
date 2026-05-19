import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBProductSync } from '@/db/schema/qbProductSync'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import { seedHealthyPortal } from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (product is not mapped and the "create new products" setting is off)', () => {
  const apis = setupInvoiceCreatedTest()

  it('bills the unmapped product under "Assembly Service" and never creates a new product in QuickBooks', async () => {
    await seedHealthyPortal({ setting: { createNewProductFlag: false } })
    // intentionally no seedProductSync() — the line item's product is unmapped

    const res = await postWebhook(invoiceCreatedPayload)
    expect(res.status).toBe(200)

    // Copilot product lookup still runs — the flag check happens after.
    expect(apis.copilot.getProduct).toHaveBeenCalled()

    // The line item falls back to the generic Assembly Service item.
    expect(apis.intuit.getAnItem).toHaveBeenCalledWith('Assembly Service')

    // createItem may run once to set up the Assembly Service item itself, but
    // it must never run for the unmapped product. Asserting on Name is more
    // robust than a call-count check.
    const createItemNames = apis.intuit.createItem.mock.calls.map(
      ([payload]) => payload?.Name,
    )
    expect(createItemNames).not.toContain('Test Product')

    // No mapping row written — the flag-off behavior we care about most.
    expect(await db.select().from(QBProductSync)).toHaveLength(0)

    // The invoice itself is still synced.
    expect(await db.select().from(QBInvoiceSync)).toHaveLength(1)
  })
})
