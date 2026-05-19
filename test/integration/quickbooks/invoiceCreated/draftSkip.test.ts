import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBCustomers } from '@/db/schema/qbCustomers'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import { seedHealthyPortal } from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (draft invoices are ignored)', () => {
  const apis = setupInvoiceCreatedTest()

  it('does nothing — no QuickBooks calls, no database rows, no sync logs', async () => {
    await seedHealthyPortal()

    const draftPayload = {
      ...invoiceCreatedPayload,
      data: { ...invoiceCreatedPayload.data, status: 'draft' },
    }
    const res = await postWebhook(draftPayload)
    expect(res.status).toBe(200)

    expect(apis.copilot.getClient).not.toHaveBeenCalled()
    expect(apis.intuit.createCustomer).not.toHaveBeenCalled()
    expect(apis.intuit.createInvoice).not.toHaveBeenCalled()

    expect(await db.select().from(QBSyncLog)).toHaveLength(0)
    expect(await db.select().from(QBCustomers)).toHaveLength(0)
    expect(await db.select().from(QBInvoiceSync)).toHaveLength(0)
  })
})
