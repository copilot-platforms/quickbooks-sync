import type { z } from 'zod'

import { InvoiceDeletedResponseSchema } from '@/type/dto/webhook.dto'
import {
  TEST_CLIENT_ID,
  TEST_COPILOT_INVOICE_ID,
  TEST_INVOICE_NUMBER,
} from '@test/helpers/seed'

type Envelope = {
  eventType: 'invoice.deleted'
  object: 'invoice'
}

// Deleted is dispatched as `payload.data` and parsed flat (no status/tax).
type InvoiceDeletedFixture = Envelope & {
  data: z.input<typeof InvoiceDeletedResponseSchema>
}

export const invoiceDeletedPayload: InvoiceDeletedFixture = {
  eventType: 'invoice.deleted',
  object: 'invoice',
  data: {
    id: TEST_COPILOT_INVOICE_ID,
    number: TEST_INVOICE_NUMBER,
    total: 60000,
    clientId: TEST_CLIENT_ID,
    companyId: '',
  },
}
