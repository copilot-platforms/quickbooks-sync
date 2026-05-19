import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_PORTAL_ID,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (same webhook delivered twice)', () => {
  const apis = setupInvoiceCreatedTest()

  it('processes the invoice only once when a sync log for it already exists', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    // Simulate a prior delivery that already claimed this invoice. Any further
    // delivery for the same Copilot invoice id should be a no-op.
    await db.insert(QBSyncLog).values({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.CREATED,
      status: LogStatus.PENDING,
      copilotId: TEST_COPILOT_INVOICE_ID,
      invoiceNumber: TEST_INVOICE_NUMBER,
    })

    const res = await postWebhook(invoiceCreatedPayload)
    expect(res.status).toBe(200)

    // The seeded log row is left exactly as it was; the second delivery did
    // not overwrite it or insert a new row.
    const logs = await db.select().from(QBSyncLog)
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe(LogStatus.PENDING)

    expect(apis.intuit.createInvoice).not.toHaveBeenCalled()
    expect(apis.intuit.createCustomer).not.toHaveBeenCalled()
    expect(await db.select().from(QBInvoiceSync)).toHaveLength(0)
  })
})
