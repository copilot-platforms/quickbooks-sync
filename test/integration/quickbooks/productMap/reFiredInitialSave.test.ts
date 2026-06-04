import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'

import { seedHealthyPortal } from '@test/helpers/seed'
import { setupProductCreatedTest } from '@test/helpers/productCreatedTestSetup'
import { postProductMap } from '@test/helpers/productMap'

const PRODUCT_ID = '2cf93cf0-45fa-485f-b584-03c2c38a3999'

describe('POST /api/quickbooks/product/map — repeated initial save', () => {
  // Reuse the harness for truncate + mock install (mocks auth).
  setupProductCreatedTest()

  it('returns the saved mapping instead of an empty list when the same initial save is sent twice', async () => {
    // initialProductSettingMap=false keeps both POSTs on the initial-insert
    // path, so the second one collides with the (portal_id, product_id) unique
    // index and is skipped by onConflictDoNothing.
    await seedHealthyPortal({ setting: { initialProductSettingMap: false } })

    const body = {
      mappingItems: [
        {
          productId: PRODUCT_ID,
          name: 'Test Product',
          copilotName: 'Test Product',
          description: '',
          qbItemId: '999',
          qbSyncToken: '0',
          isExcluded: false,
        },
      ],
      changedItemReference: [],
    }

    const first = await postProductMap(body)
    expect(first.status).toBe(200)

    const second = await postProductMap(body)
    expect(second.status).toBe(200)

    // The re-fired save no-ops on the conflict but must still return the live
    // mapping, not the [] that a bare RETURNING would yield for skipped rows.
    const secondMapping = await second.json()
    expect(secondMapping).toHaveLength(1)
    expect(secondMapping[0].productId).toBe(PRODUCT_ID)

    // And it must not have created a duplicate row.
    const rows = await db
      .select()
      .from(QBProductSync)
      .where(eq(QBProductSync.productId, PRODUCT_ID))
    expect(rows).toHaveLength(1)
  })
})
