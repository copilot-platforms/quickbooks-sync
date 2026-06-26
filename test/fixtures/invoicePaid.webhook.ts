import type { z } from 'zod'

import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { InvoiceResponseSchema } from '@/type/dto/webhook.dto'
import {
  TEST_CLIENT_ID,
  TEST_COPILOT_INVOICE_ID,
  TEST_INVOICE_NUMBER,
} from '@test/helpers/seed'

type Envelope = {
  eventType: 'invoice.paid'
  object: 'invoice'
}

type InvoicePaidFixture = Envelope & z.input<typeof InvoiceResponseSchema>

export const invoicePaidPayload: InvoicePaidFixture = {
  eventType: 'invoice.paid',
  object: 'invoice',
  data: {
    id: TEST_COPILOT_INVOICE_ID,
    number: TEST_INVOICE_NUMBER,
    status: InvoiceStatus.PAID,
    total: 60000,
    taxPercentage: 0,
    taxAmount: 0,
    clientId: TEST_CLIENT_ID,
    companyId: '',
  },
}
