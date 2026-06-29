import type { z } from 'zod'

import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { InvoiceResponseSchema } from '@/type/dto/webhook.dto'
import {
  TEST_CLIENT_ID,
  TEST_COPILOT_INVOICE_ID,
  TEST_INVOICE_NUMBER,
} from '@test/helpers/seed'

type Envelope = {
  eventType: 'invoice.voided'
  object: 'invoice'
}

type InvoiceVoidedFixture = Envelope & z.input<typeof InvoiceResponseSchema>

// Voided uses the same `data` envelope (InvoiceResponseSchema) as created/paid.
export const invoiceVoidedPayload: InvoiceVoidedFixture = {
  eventType: 'invoice.voided',
  object: 'invoice',
  data: {
    id: TEST_COPILOT_INVOICE_ID,
    number: TEST_INVOICE_NUMBER,
    status: InvoiceStatus.OPEN,
    total: 60000,
    taxPercentage: 0,
    // Payload tax field; the real tax comes from the CREATED log.
    taxAmount: 0,
    clientId: TEST_CLIENT_ID,
    companyId: '',
  },
}
