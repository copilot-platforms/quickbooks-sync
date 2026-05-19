import type { z } from 'zod'

import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { InvoiceCreatedResponseSchema } from '@/type/dto/webhook.dto'

type Envelope = {
  eventType: 'invoice.created'
  object: 'invoice'
}

type InvoiceCreatedFixture = Envelope &
  z.input<typeof InvoiceCreatedResponseSchema>

const invoiceCreatedPayload: InvoiceCreatedFixture = {
  eventType: 'invoice.created',
  object: 'invoice',
  data: {
    id: 'inv-cop-0001',
    number: 'INV-0001',
    status: InvoiceStatus.OPEN,
    total: 60000,
    clientId: '11111111-1111-1111-1111-111111111111',
    companyId: '',
    lineItems: [
      {
        productId: '2cf93cf0-45fa-485f-b584-03c2c38a3999',
        priceId: 'C-wch-eSg',
        amount: 60000,
        quantity: 1,
        description: 'Test product line',
      },
    ],
    paymentMethodPreferences: [],
    taxAmount: 0,
    taxPercentage: null,
    sentDate: '2026-05-08T00:00:00.000Z',
    dueDate: '2026-05-15T00:00:00.000Z',
  },
}

export default invoiceCreatedPayload
