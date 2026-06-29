import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { invoiceVoidedPayload } from '@test/fixtures/invoiceVoided.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoiceVoidedTest } from '@test/helpers/invoiceVoidedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.voided (no created log to copy the amount from)', () => {
  const apis = setupInvoiceVoidedTest()

  it('records a FAILED voided log and voids nothing when the invoice.created log is absent', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({ customerId: customer.id })
    // No created log, so there's no amount to carry over.

    const res = await postWebhook(invoiceVoidedPayload)
    expect(res.status).toBe(200)

    const voidedLogs = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID),
          eq(QBSyncLog.eventType, EventType.VOIDED),
        ),
      )
    expect(voidedLogs).toHaveLength(1)
    expect(voidedLogs[0]).toMatchObject({
      entityType: EntityType.INVOICE,
      eventType: EventType.VOIDED,
      status: LogStatus.FAILED,
    })
    expect(voidedLogs[0].errorMessage).toContain('Invoice sync log not found')

    expect(apis.intuit.voidInvoice).not.toHaveBeenCalled()
  })
})
