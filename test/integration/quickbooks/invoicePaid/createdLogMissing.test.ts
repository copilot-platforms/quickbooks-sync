import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { invoicePaidPayload } from '@test/fixtures/invoicePaid.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoicePaidTest } from '@test/helpers/invoicePaidTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.paid (no created log to read the amount from)', () => {
  const apis = setupInvoicePaidTest()

  it('records a FAILED paid log and creates no payment when the invoice.created log is absent', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({ customerId: customer.id })
    // No invoice.created sync log — webhookInvoicePaid has no amount to bill.

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
    expect(paidLogs[0].errorMessage).toContain('Invoice sync log not found')

    expect(apis.intuit.createPayment).not.toHaveBeenCalled()
  })
})
