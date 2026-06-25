import type { z } from 'zod'

import { PaymentStatus } from '@/app/api/core/types/invoice'
import { PaymentSucceededResponseSchema } from '@/type/dto/webhook.dto'
import {
  TEST_COPILOT_INVOICE_ID,
  TEST_COPILOT_PAYMENT_ID,
} from '@test/helpers/seed'

type Envelope = {
  eventType: 'payment.succeeded'
  object: 'payment'
}

type PaymentSucceededFixture = Envelope &
  z.input<typeof PaymentSucceededResponseSchema>

export const paymentSucceededPayload: PaymentSucceededFixture = {
  eventType: 'payment.succeeded',
  object: 'payment',
  data: {
    id: TEST_COPILOT_PAYMENT_ID,
    invoiceId: TEST_COPILOT_INVOICE_ID,
    status: PaymentStatus.SUCCEEDED,
    paymentMethod: 'creditCard',
    brand: 'visa',
    feeAmount: { paidByPlatform: 2500, paidByClient: 0 },
    createdAt: '2024-02-21T15:31:16.789Z',
  },
}
