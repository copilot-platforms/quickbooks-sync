import { describe, it, expect } from 'vitest'
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
import { setupInvoiceVoidedTest } from '@test/helpers/invoiceVoidedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.voided (sync row missing its QuickBooks id)', () => {
  const apis = setupInvoiceVoidedTest()

  it('records a FAILED voided log and voids nothing when the synced invoice has no QuickBooks id', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    // An OPEN sync row with no QBO invoice id can't build a void payload.
    await seedQBInvoiceSync({ customerId: customer.id, qbInvoiceId: null })
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
    expect(voidedLogs[0].errorMessage).toContain(
      'Could not parse invoice destructive payload',
    )

    expect(apis.intuit.voidInvoice).not.toHaveBeenCalled()

    // The sync row is left open since the void never reached QBO.
    const [invoiceSync] = await db
      .select()
      .from(QBInvoiceSync)
      .where(eq(QBInvoiceSync.invoiceNumber, TEST_INVOICE_NUMBER))
    expect(invoiceSync.status).toBe(InvoiceStatus.OPEN)
  })
})
