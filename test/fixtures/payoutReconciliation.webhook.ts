import type { z } from 'zod'

import { WebhookEvents } from '@/app/api/core/types/webhook'
import { PayoutReconciliationCompletedSchema } from '@/type/dto/webhook.dto'

export const TEST_PAYOUT_ID = 'po-test-0001'
export const TEST_COPILOT_INVOICE_ID_A = 'inv-cop-A'
export const TEST_COPILOT_INVOICE_ID_B = 'inv-cop-B'

type PayoutFixture = z.input<typeof PayoutReconciliationCompletedSchema>

// Two-invoice payout. grossCents (3000) - feeCents (156) == netAmount (2844),
// so it clears the deposit-balance check in the all-batched path.
export const payoutReconciliationPayload: PayoutFixture = {
  eventType: WebhookEvents.PAYOUT_RECONCILIATION_COMPLETED,
  eventTime: '1784705274',
  data: {
    payout: {
      id: TEST_PAYOUT_ID,
      arrivalDate: 1784705701,
      currency: 'usd',
      netAmount: 2844,
      status: 'paid',
    },
    lineItems: [
      {
        copilotInvoiceId: TEST_COPILOT_INVOICE_ID_A,
        grossAmount: 1000,
        feeAmount: 62,
      },
      {
        copilotInvoiceId: TEST_COPILOT_INVOICE_ID_B,
        grossAmount: 2000,
        feeAmount: 94,
      },
    ],
  },
}
