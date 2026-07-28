import { describe, it, expect, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { QBOErrorCodes } from '@/constant/intuitErrorCode'
import { HttpFetchError } from '@/utils/error'

import { invoiceVoidedPayload } from '@test/fixtures/invoiceVoided.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  seedInvoiceCreatedLog,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceVoidedTest } from '@test/helpers/invoiceVoidedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

// Invoice voided out-of-band in QBO leaves our row OPEN, so the void hits a
// stale SyncToken → 5010 → FAILED with error_code=5010 (routes to QB_STALE_OBJECT).
describe('POST /api/quickbooks/webhook — invoice.voided (QBO returns 5010 stale object)', () => {
  const apis = setupInvoiceVoidedTest(() => ({
    intuit: createMockIntuitAPI({
      voidInvoice: vi.fn().mockRejectedValue(
        new HttpFetchError({
          status: 400,
          statusText: 'Bad Request',
          url: 'https://quickbooks.api.intuit.com/v3/company/realm/invoice',
          body: {
            Fault: {
              Error: [
                {
                  code: String(QBOErrorCodes.STALE_OBJECT),
                  Message: 'Stale Object Error',
                  Detail:
                    'Stale Object Error : You and quickbooks-sync were working on this at the same time.',
                },
              ],
              type: 'ValidationFault',
            },
          },
        }),
      ),
    }),
  }))

  it('marks the voided log FAILED with error_code 5010 (routes to QB_STALE_OBJECT)', async () => {
    await seedHealthyPortal()
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({ customerId: customer.id }) // defaults to OPEN
    await seedInvoiceCreatedLog()

    const res = await postWebhook(invoiceVoidedPayload)
    expect(res.status).toBe(200)

    const [voidedLog] = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID),
          eq(QBSyncLog.eventType, EventType.VOIDED),
        ),
      )
    expect(voidedLog.entityType).toBe(EntityType.INVOICE)
    expect(voidedLog.status).toBe(LogStatus.FAILED)
    // The QBO fault code must survive as error_code to route to QB_STALE_OBJECT.
    expect(voidedLog.errorCode).toBe(String(QBOErrorCodes.STALE_OBJECT))

    expect(apis.intuit.voidInvoice).toHaveBeenCalledTimes(1)
  })
})
