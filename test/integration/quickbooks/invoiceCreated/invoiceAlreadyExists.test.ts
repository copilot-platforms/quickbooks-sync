import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBCustomers } from '@/db/schema/qbCustomers'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { LogStatus } from '@/app/api/core/types/log'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import {
  seedHealthyPortal,
  seedProductSync,
  seedQBInvoiceSync,
} from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (invoice was already synced before)', () => {
  const apis = setupInvoiceCreatedTest()

  it('does not sync the invoice again or call QuickBooks', async () => {
    await seedHealthyPortal()
    await seedProductSync()
    await seedQBInvoiceSync()

    const res = await postWebhook(invoiceCreatedPayload)
    expect(res.status).toBe(200)

    // The pre-seeded mapping is the only row; no second invoice was created.
    const invoices = await db.select().from(QBInvoiceSync)
    expect(invoices).toHaveLength(1)

    // The new delivery still claimed a log row but never completed it — the
    // stale-pending reaper handles cleanup later.
    const logs = await db.select().from(QBSyncLog)
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe(LogStatus.PENDING)

    expect(apis.intuit.createInvoice).not.toHaveBeenCalled()
    expect(await db.select().from(QBCustomers)).toHaveLength(0)
  })
})
