import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'

import { seedHealthyPortal, seedProductSync } from '@test/helpers/seed'
import { setupProductCreatedTest } from '@test/helpers/productCreatedTestSetup'
import { postProductMap } from '@test/helpers/productMap'

const PRODUCT_ID = '2cf93cf0-45fa-485f-b584-03c2c38a3999'

describe('POST /api/quickbooks/product/map — product-keyed upsert', () => {
  // Reuse the harness for truncate + mock install (mocks auth).
  setupProductCreatedTest()

  it('updates the single product row rather than creating a per-price duplicate', async () => {
    // initialProductSettingMap=true → handleProductMap uses changedItemReference.
    await seedHealthyPortal()
    await seedProductSync({ productId: PRODUCT_ID, qbItemId: '999' })

    const body = {
      mappingItems: [],
      changedItemReference: [
        {
          id: PRODUCT_ID,
          name: 'Test Product',
          isExcluded: false,
          qbItem: {
            id: '777',
            name: 'Test Product',
            syncToken: '0',
            description: '',
          },
        },
      ],
    }

    const res = await postProductMap(body)
    expect(res.status).toBe(200)

    const rows = await db
      .select()
      .from(QBProductSync)
      .where(eq(QBProductSync.productId, PRODUCT_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].qbItemId).toBe('777')
  })
})
