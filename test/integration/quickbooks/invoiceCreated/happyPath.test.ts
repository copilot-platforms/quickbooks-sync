import { describe, it, expect } from 'vitest'
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
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (happy path)', () => {
  const apis = setupInvoiceCreatedTest()

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
    const [invoicePayload] = apis.intuit.createInvoice.mock.calls[0]
    expect(invoicePayload).toMatchObject({
      DocNumber: TEST_INVOICE_NUMBER,
      CustomerRef: { value: TEST_QB_CUSTOMER_ID },
    })
    expect(invoicePayload.Line[0].SalesItemLineDetail.ItemRef).toEqual({
      value: '999',
    })
  })
})
