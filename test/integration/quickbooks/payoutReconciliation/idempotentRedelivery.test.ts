import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { payoutPayload } from '@test/fixtures/payout.webhook'
import {
  seedHealthyPortal,
  TEST_PORTAL_ID,
  TEST_COPILOT_INVOICE_ID,
  TEST_BANK_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('payout — the same webhook is redelivered', () => {
  const apis = setupPaymentSucceededTest()

  it('creates the deposit only once and keeps a single payout/settled log', async () => {
    await seedHealthyPortal({
      portal: {
        bankAccountRef: TEST_BANK_ACCOUNT_REF,
        expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
      },
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: true },
    })
    await db.insert(QBSyncLog).values([
      {
        portalId: TEST_PORTAL_ID,
        copilotId: TEST_COPILOT_INVOICE_ID,
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.SUCCESS,
        quickbooksId: 'qbpay_A',
      },
      {
        portalId: TEST_PORTAL_ID,
        copilotId: 'inv-cop-0002',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.SUCCESS,
        quickbooksId: 'qbpay_B',
      },
    ])

    const first = await postWebhook(payoutPayload)
    expect(first.status).toBe(200)
    const second = await postWebhook(payoutPayload)
    expect(second.status).toBe(200)

    expect(apis.intuit.createDeposit).toHaveBeenCalledTimes(1)

    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, 'po_test_1'))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.PAYOUT,
      eventType: EventType.SETTLED,
      status: LogStatus.SUCCESS,
    })
  })
})
