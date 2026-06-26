import { describe, it, expect, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { InvoiceStatus } from '@/app/api/core/types/invoice'

import { invoicePaidPayload } from '@test/fixtures/invoicePaid.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  seedInvoiceCreatedLog,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoicePaidTest } from '@test/helpers/invoicePaidTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.paid (QuickBooks rejects the payment)', () => {
  const apis = setupInvoicePaidTest(() => ({
    intuit: createMockIntuitAPI({
      createPayment: vi
        .fn()
        .mockRejectedValue(new Error('QuickBooks is on fire')),
    }),
  }))

  it('marks the paid log FAILED and leaves the invoice unpaid when payment creation fails', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({ customerId: customer.id })
    await seedInvoiceCreatedLog()

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
    expect(paidLogs[0].errorMessage).toContain('QuickBooks is on fire')

    expect(apis.intuit.createPayment).toHaveBeenCalledTimes(1)

    // Invoice status is not flipped to paid when the payment never lands.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.OPEN)
  })
})
