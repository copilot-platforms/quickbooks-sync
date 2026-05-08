import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { LogStatus } from '@/app/api/core/types/log'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import {
  seedHealthyPortal,
  seedProductSync,
  seedQBInvoiceSync,
} from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

/**
 * If qb_invoice_sync already has a row for the invoice number,
 * InvoiceService#getInvoiceByNumber short-circuits webhookInvoiceCreated.
 * The claim row is left as PENDING (orphaned) — documented behavior; the
 * stale-pending reaper will eventually flip it to FAILED.
 */
describe('POST /api/quickbooks/webhook — invoice.created (invoice already exists)', () => {
  const apis = setupInvoiceCreatedTest()

  it('short-circuits without QB calls when sync row already exists', async () => {
    await seedHealthyPortal()
    await seedProductSync()
    await seedQBInvoiceSync()

    const res = await postWebhook(invoiceCreatedPayload)
    expect(res.status).toBe(200)

    // No second invoice row inserted
    const invoices = await db.select().from(QBInvoiceSync)
    expect(invoices).toHaveLength(1)

    // The claim row was written then orphaned at PENDING
    const logs = await db.select().from(QBSyncLog)
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe(LogStatus.PENDING)

    // Customer flow still ran (existence check sits AFTER customer resolution
    // in webhookInvoiceCreated, currently). Pin negatively only on the
    // final QB call to avoid over-coupling the test to internal call order.
    expect(apis.intuit.createInvoice).not.toHaveBeenCalled()
  })
})
