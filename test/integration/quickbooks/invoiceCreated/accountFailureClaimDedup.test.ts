import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import {
  EntityType,
  EventType,
  FailedRecordCategoryType,
  LogStatus,
} from '@/app/api/core/types/log'
import { HttpFetchError } from '@/utils/error'
import { QBOErrorCodes } from '@/constant/intuitErrorCode'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_COPILOT_INVOICE_ID,
  TEST_PORTAL_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

const intuitUrl =
  'https://sandbox-quickbooks.api.intuit.com/v3/company/123/customer'

const accountSuspendedError = () =>
  new HttpFetchError({
    status: 403,
    statusText: 'Forbidden',
    url: intuitUrl,
    body: {
      Fault: {
        Error: [
          {
            code: String(QBOErrorCodes.ACCOUNT_SUSPENDED),
            Message: 'Account Suspended',
            Detail: 'Your QuickBooks subscription is suspended.',
          },
        ],
        type: 'ValidationFault',
      },
    },
  })

describe('POST /api/quickbooks/webhook — invoice.created with a suspended QuickBooks account', () => {
  // Build a fresh mocked IntuitAPI per test, with createCustomer rejecting via
  // an HttpFetchError whose Fault.Error[0].code = 6190 (ACCOUNT_SUSPENDED).
  // getMessageAndCodeFromError surfaces 6190 → AccountErrorCodes → getCategory
  // returns FailedRecordCategoryType.ACCOUNT. The test confirms the failure
  // row stays live (deletedAt null) so the partial unique index dedupes the
  // repeat webhook delivery; shouldRetry remains true so the cron will retry
  // once the customer's QBO subscription is restored.
  const apis = setupInvoiceCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      createCustomer: vi.fn().mockRejectedValue(accountSuspendedError()),
    }),
  }))

  it('keeps the claim row live so a repeat webhook delivery dedupes via the partial unique index', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    // First delivery: handler claims, calls QBO, hits ACCOUNT_SUSPENDED,
    // updates the claim row to FAILED. shouldRetry stays true so the cron
    // re-attempts once the customer renews their QBO subscription.
    const res1 = await postWebhook(invoiceCreatedPayload)
    expect(res1.status).toBe(200)

    const rowsAfterFirst = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID))

    expect(rowsAfterFirst).toHaveLength(1)
    expect(rowsAfterFirst[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.CREATED,
      status: LogStatus.FAILED,
      category: FailedRecordCategoryType.ACCOUNT,
      shouldRetry: true,
    })
    expect(rowsAfterFirst[0].deletedAt).toBeNull()

    // Second delivery (Copilot retry): claimWebhookEvent's partial unique
    // index conflicts because the live row is still in the deletedAt-IS-NULL
    // slice. Handler exits early; QBO is not called a second time.
    apis.intuit.createCustomer.mockClear()
    const res2 = await postWebhook(invoiceCreatedPayload)
    expect(res2.status).toBe(200)

    const rowsAfterSecond = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID))
    expect(rowsAfterSecond).toHaveLength(1)
    expect(rowsAfterSecond[0].id).toBe(rowsAfterFirst[0].id)
    expect(apis.intuit.createCustomer).not.toHaveBeenCalled()
  })
})
