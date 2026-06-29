import { describe, it, expect, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { InvoiceStatus } from '@/app/api/core/types/invoice'

import { invoiceVoidedPayload } from '@test/fixtures/invoiceVoided.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  seedInvoiceCreatedLog,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceVoidedTest } from '@test/helpers/invoiceVoidedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.voided (QuickBooks rejects the void)', () => {
  const apis = setupInvoiceVoidedTest(() => ({
    intuit: createMockIntuitAPI({
      voidInvoice: vi
        .fn()
        .mockRejectedValue(new Error('QuickBooks is on fire')),
    }),
  }))

  it('marks the voided log FAILED and leaves the invoice open when the void fails', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({ customerId: customer.id })
    await seedInvoiceCreatedLog()

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
    expect(voidedLogs[0].errorMessage).toContain('QuickBooks is on fire')

    expect(apis.intuit.voidInvoice).toHaveBeenCalledTimes(1)

    // Invoice status stays open when the void never lands in QBO.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.OPEN)
  })
})
