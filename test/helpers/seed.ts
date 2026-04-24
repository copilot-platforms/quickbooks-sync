import type { InferInsertModel } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '@/db'
import {
  QBPortalConnection,
  QBPortalConnectionCreateSchema,
} from '@/db/schema/qbPortalConnections'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSetting, QBSettingCreateSchema } from '@/db/schema/qbSettings'

export const TEST_PORTAL_ID = 'test-portal-00000001'
export const TEST_REALM_ID = 'test-realm-123'
export const TEST_ACCESS_TOKEN = 'test-access-token'
export const TEST_REFRESH_TOKEN = 'test-refresh-token'
export const TEST_INCOME_ACCOUNT_REF = '100'
export const TEST_ASSET_ACCOUNT_REF = '101'
export const TEST_EXPENSE_ACCOUNT_REF = '102'
export const TEST_INTERNAL_USER_ID = 'test-internal-user-id'
export const TEST_WEBHOOK_TOKEN = 'test-token-xyz'

// Override types are derived from the Drizzle-generated insert schemas so
// they stay in sync with the DB schema automatically. Using `Partial<typeof base>`
// would widen primitives (e.g., `true` → `boolean`) but wouldn't track column
// type changes in the underlying schema.
type PortalOverrides = Partial<z.infer<typeof QBPortalConnectionCreateSchema>>
type SettingOverrides = Partial<z.infer<typeof QBSettingCreateSchema>>
type ProductSyncOverrides = Partial<InferInsertModel<typeof QBProductSync>>

const basePortalConnection: z.infer<typeof QBPortalConnectionCreateSchema> = {
  portalId: TEST_PORTAL_ID,
  intuitRealmId: TEST_REALM_ID,
  accessToken: TEST_ACCESS_TOKEN,
  refreshToken: TEST_REFRESH_TOKEN,
  expiresIn: 3600,
  XRefreshTokenExpiresIn: 8_726_400,
  intiatedBy: TEST_INTERNAL_USER_ID,
  incomeAccountRef: TEST_INCOME_ACCOUNT_REF,
  assetAccountRef: TEST_ASSET_ACCOUNT_REF,
  expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
}

const baseSetting: z.infer<typeof QBSettingCreateSchema> = {
  portalId: TEST_PORTAL_ID,
  absorbedFeeFlag: false,
  useCompanyNameFlag: false,
  createNewProductFlag: true,
  initialInvoiceSettingMap: true,
  initialProductSettingMap: true,
  syncFlag: true,
  isEnabled: true,
}

export async function seedPortalConnection(overrides: PortalOverrides = {}) {
  const [row] = await db
    .insert(QBPortalConnection)
    .values({ ...basePortalConnection, ...overrides })
    .returning()
  return row
}

export async function seedSetting(overrides: SettingOverrides = {}) {
  const [row] = await db
    .insert(QBSetting)
    .values({ ...baseSetting, ...overrides })
    .returning()
  return row
}

const baseProductSync: InferInsertModel<typeof QBProductSync> = {
  portalId: TEST_PORTAL_ID,
  productId: '2cf93cf0-45fa-485f-b584-03c2c38a3999',
  priceId: 'C-wch-eSg',
  name: 'Test Product',
  copilotName: 'Test Product',
  unitPrice: '60000.00',
  qbItemId: '999',
  qbSyncToken: '0',
}

export async function seedProductSync(overrides: ProductSyncOverrides = {}) {
  const [row] = await db
    .insert(QBProductSync)
    .values({ ...baseProductSync, ...overrides })
    .returning()
  return row
}

/**
 * Convenience seeder for the common "healthy portal" fixture used by
 * most tests. Returns both rows for assertions if needed.
 */
export async function seedHealthyPortal(
  opts: {
    portal?: PortalOverrides
    setting?: SettingOverrides
  } = {},
) {
  const portal = await seedPortalConnection(opts.portal)
  const setting = await seedSetting(opts.setting)
  return { portal, setting }
}
