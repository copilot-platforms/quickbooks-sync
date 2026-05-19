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

describe('POST /api/quickbooks/webhook — invoice.created (typical client invoice)', () => {
  const apis = setupInvoiceCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      // Return a real QB item when looked up by id so the invoice references a
      // mapped product. Without this, the default mock would route the line
      // item through the generic "Assembly Service" fallback instead.
      getAnItem: vi
        .fn()
        .mockImplementation(async (name?: string, id?: string) => {
          if (id === '999') {
            return { Id: '999', SyncToken: '0', Active: true }
          }
          return undefined
        }),
    }),
  }))

  it('creates a customer in QuickBooks, creates the invoice, and logs the sync as successful', async () => {
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
      qbDocNumber: TEST_INVOICE_NUMBER,
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
    expect(apis.intuit.findInvoicesByDocNumberPrefix).toHaveBeenCalledWith(
      TEST_INVOICE_NUMBER,
    )
    expect(apis.intuit.findInvoicesByDocNumberPrefix).toHaveBeenCalledTimes(1)
    expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(1)
    // The product is already mapped so createItem must not run for it. The
    // only allowed createItem call is the generic Assembly Service item the
    // portal needs for one-off line items. Asserting on Name (not call count)
    // makes the test resilient to unrelated bookkeeping changes.
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
    // Mapped products take their description from Copilot, not from the
    // payload's lineItem.description. If this read 'Test product line', the
    // line item silently fell through to the unmapped path.
    expect(invoicePayload.Line[0].Description).toBe('Test product description')
  })
})
