import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBCustomers } from '@/db/schema/qbCustomers'
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

    // The existence check sits at the TOP of webhookInvoiceCreated — before
    // customer resolution. When a sync row is pre-seeded, the handler returns
    // immediately; no Copilot or Intuit calls are made beyond the claim.
    expect(apis.intuit.createInvoice).not.toHaveBeenCalled()
    expect(await db.select().from(QBCustomers)).toHaveLength(0)
  })
})
