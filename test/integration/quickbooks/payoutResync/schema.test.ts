import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBPayoutSync } from '@/db/schema/qbPayoutSync'
import { TEST_PORTAL_ID } from '@test/helpers/seed'
import { truncateAllTestTables } from '@test/helpers/testDb'

describe('qb_payout_sync table', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
  })

  it('round-trips a payout row with jsonb line items', async () => {
    await db.insert(QBPayoutSync).values({
      portalId: TEST_PORTAL_ID,
      payoutId: 'po_test_1',
      lineItems: [
        {
          copilotInvoiceId: 'inv-cop-0001',
          grossAmount: 20000,
          feeAmount: 375,
        },
      ],
      netAmount: 34425,
      feeAmount: 575,
      arrivalDate: 1713744000,
    })

    const row = await db.query.QBPayoutSync.findFirst({
      where: and(
        eq(QBPayoutSync.portalId, TEST_PORTAL_ID),
        eq(QBPayoutSync.payoutId, 'po_test_1'),
      ),
    })

    expect(row?.qbDepositId).toBeNull()
    expect(row?.lineItems).toEqual([
      { copilotInvoiceId: 'inv-cop-0001', grossAmount: 20000, feeAmount: 375 },
    ])
  })
})
