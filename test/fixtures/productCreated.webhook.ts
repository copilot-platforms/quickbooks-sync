import type { z } from 'zod'

import { ProductStatus } from '@/app/api/core/types/product'
import { ProductCreatedResponseSchema } from '@/type/dto/webhook.dto'

type Envelope = {
  eventType: 'product.created'
  object: 'product'
  created: string
}

type ProductCreatedFixture = Envelope &
  z.input<typeof ProductCreatedResponseSchema>

const productCreatedPayload: ProductCreatedFixture = {
  eventType: 'product.created',
  object: 'product',
  created: '2024-09-11T13:59:58.845233992Z',
  data: {
    id: '2cf93cf0-45fa-485f-b584-03c2c38a3999',
    name: 'Test Product',
    status: ProductStatus.ACTIVE,
    description: 'Test product description',
  },
}

export default productCreatedPayload
