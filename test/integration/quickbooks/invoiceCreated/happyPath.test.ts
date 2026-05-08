import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBCustomers } from '@/db/schema/qbCustomers'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_PORTAL_ID,
  TEST_QB_CUSTOMER_ID,
  TEST_QB_INVOICE_ID,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (happy path)', () => {
  const apis = setupInvoiceCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      // Override getAnItem so the product-mapping path returns a real item
      // when queried by id (default mock returns undefined for every call,
      // which collapses both branches of getInvoiceItemRef into the
      // Assembly Service one-off — see docs/superpowers/specs/2026-05-08...).
      // Tests want to pin the mapped-product branch, not the fallback.
      getAnItem: vi
        .fn()
        .mockImplementation(async (name?: string, id?: string) => {
          if (id === '999') {
            return { Id: '999', SyncToken: '0', Active: true }
          }
          return undefined // 'Assembly Service' lookup → triggers manageServiceItemRef
        }),
    }),
  }))

  it('creates QB customer + invoice, writes mappings, logs SUCCESS', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const res = await postWebhook(invoiceCreatedPayload)
    expect(res.status).toBe(200)

    const customers = await db.select().from(QBCustomers)
    expect(customers).toHaveLength(1)
    expect(customers[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      qbCustomerId: TEST_QB_CUSTOMER_ID,
      customerType: 'client',
      email: 'jane@example.com',
    })

    const invoices = await db.select().from(QBInvoiceSync)
    expect(invoices).toHaveLength(1)
    expect(invoices[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      invoiceNumber: TEST_INVOICE_NUMBER,
      qbInvoiceId: TEST_QB_INVOICE_ID,
      status: 'open',
    })

    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.CREATED,
      status: LogStatus.SUCCESS,
      copilotId: TEST_COPILOT_INVOICE_ID,
      invoiceNumber: TEST_INVOICE_NUMBER,
      quickbooksId: TEST_QB_INVOICE_ID,
    })

    expect(apis.copilot.getClient).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
    )
    expect(apis.intuit.createCustomer).toHaveBeenCalledTimes(1)
    expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(1)
    // Product was already mapped — createItem must not be invoked for the
    // mapped product. handleServiceItem still creates the 'Assembly Service'
    // one-off item (because seedHealthyPortal does not set serviceItemRef),
    // so the only allowed createItem call is the Assembly Service one.
    const createItemNames = apis.intuit.createItem.mock.calls.map(
      ([payload]) => payload?.Name,
    )
    expect(createItemNames).toEqual(['Assembly Service'])
    const [invoicePayload] = apis.intuit.createInvoice.mock.calls[0]
    expect(invoicePayload).toMatchObject({
      DocNumber: TEST_INVOICE_NUMBER,
      CustomerRef: { value: TEST_QB_CUSTOMER_ID },
    })
    expect(invoicePayload.Line[0].SalesItemLineDetail.ItemRef).toEqual({
      value: '999',
    })
    // Mapped-product branch sets Description from copilot.getProduct (not the
    // payload's lineItem.description). The fallback path leaves
    // productDescription undefined, which would surface 'Test product line'
    // here. This pins the mapped branch.
    expect(invoicePayload.Line[0].Description).toBe('Test product description')
  })
})
