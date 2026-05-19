import type { z } from 'zod'

import { PriceCreatedResponseSchema } from '@/type/dto/webhook.dto'

type Envelope = {
  eventType: 'price.created'
  object: 'price'
  created: string
}

type PriceCreatedFixture = Envelope & z.input<typeof PriceCreatedResponseSchema>

const priceCreatedPayload: PriceCreatedFixture = {
  eventType: 'price.created',
  object: 'price',
  created: '2024-09-11T13:59:58.845233992Z',
  data: {
    id: 'C-wch-eSg',
    productId: '2cf93cf0-45fa-485f-b584-03c2c38a3999',
    amount: 60000,
    type: 'recurring',
  },
}

export default priceCreatedPayload
