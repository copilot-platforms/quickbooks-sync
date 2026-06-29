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
  seedInvoiceCreatedLog,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { setupInvoiceVoidedTest } from '@test/helpers/invoiceVoidedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.voided (created sync still in flight)', () => {
  const apis = setupInvoiceVoidedTest()

  it('records a FAILED voided log and voids nothing when the invoice.created log is still PENDING', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({ customerId: customer.id })
    // A PENDING created log means the invoice isn't synced yet.
    await seedInvoiceCreatedLog({
      status: LogStatus.PENDING,
      amount: null,
      taxAmount: null,
      quickbooksId: null,
    })

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
    expect(voidedLogs[0].errorMessage).toContain(
      'Invoice sync log still pending',
    )

    expect(apis.intuit.voidInvoice).not.toHaveBeenCalled()
  })
})
