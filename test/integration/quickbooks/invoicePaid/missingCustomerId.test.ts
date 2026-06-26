import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { invoicePaidPayload } from '@test/fixtures/invoicePaid.webhook'
import {
  seedHealthyPortal,
  seedQBInvoiceSync,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoicePaidTest } from '@test/helpers/invoicePaidTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.paid (invoice has no linked customer)', () => {
  const apis = setupInvoicePaidTest()

  it('records a FAILED paid log and creates no payment when the synced invoice has no customerId', async () => {
    await seedHealthyPortal()
    // customerId left null — the invoice was synced without a customer mapping.
    await seedQBInvoiceSync({ customerId: null })

    const res = await postWebhook(invoicePaidPayload)
    expect(res.status).toBe(200)

    const paidLogs = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID),
          eq(QBSyncLog.eventType, EventType.PAID),
        ),
      )
    expect(paidLogs).toHaveLength(1)
    expect(paidLogs[0]).toMatchObject({
      entityType: EntityType.INVOICE,
      eventType: EventType.PAID,
      status: LogStatus.FAILED,
    })
    expect(paidLogs[0].errorMessage).toContain('CustomerId not found')

    expect(apis.intuit.createPayment).not.toHaveBeenCalled()
  })
})
