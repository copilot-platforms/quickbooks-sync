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

/**
 * A pre-existing CREATED log row for the same copilotId blocks a second
 * delivery. claimWebhookEvent returns { claimed: false } and the handler
 * exits without doing any service work.
 */
describe('POST /api/quickbooks/webhook — invoice.created (idempotency)', () => {
  const apis = setupInvoiceCreatedTest()

  it('skips the handler when a CREATED log already exists', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    // Pre-existing claim row for this copilotInvoiceId
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

    // Still exactly one log row — the seeded one, untouched
    const logs = await db.select().from(QBSyncLog)
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe(LogStatus.PENDING)

    // No service work
    expect(apis.intuit.createInvoice).not.toHaveBeenCalled()
    expect(apis.intuit.createCustomer).not.toHaveBeenCalled()
    expect(await db.select().from(QBInvoiceSync)).toHaveLength(0)
  })
})
