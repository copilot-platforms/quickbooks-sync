import type { InferInsertModel } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '@/db'
import {
  QBPortalConnection,
  QBPortalConnectionCreateSchema,
} from '@/db/schema/qbPortalConnections'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSetting, QBSettingCreateSchema } from '@/db/schema/qbSettings'
import { QBCustomers } from '@/db/schema/qbCustomers'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { InvoiceStatus } from '@/app/api/core/types/invoice'

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
  // Keeps `isTokenFresh` true so tests don't trigger a real Intuit OAuth call.
  tokenSetTime: new Date(),
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
  name: 'Test Product',
  copilotName: 'Test Product',
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

export const TEST_CLIENT_ID = '11111111-1111-1111-1111-111111111111'
export const TEST_COMPANY_ID = '22222222-2222-2222-2222-222222222222'
export const TEST_QB_CUSTOMER_ID = 'qb-cust-1'
export const TEST_QB_INVOICE_ID = 'qb-inv-1'
export const TEST_INVOICE_NUMBER = 'INV-0001'
export const TEST_COPILOT_INVOICE_ID = 'inv-cop-0001'

type CustomerOverrides = Partial<InferInsertModel<typeof QBCustomers>>
type InvoiceSyncOverrides = Partial<InferInsertModel<typeof QBInvoiceSync>>

const baseCustomer: InferInsertModel<typeof QBCustomers> = {
  portalId: TEST_PORTAL_ID,
  customerId: TEST_CLIENT_ID,
  // clientCompanyId = clientId alone: production composeClientCompanyById
  // returns just the clientId when the invoice has no companyId.
  clientCompanyId: TEST_CLIENT_ID,
  clientId: TEST_CLIENT_ID,
  companyId: null,
  givenName: 'Jane',
  familyName: 'Doe',
  displayName: 'Jane Doe',
  email: 'jane@example.com',
  companyName: null,
  customerType: 'client',
  qbSyncToken: '0',
  qbCustomerId: TEST_QB_CUSTOMER_ID,
}

export async function seedQBCustomer(overrides: CustomerOverrides = {}) {
  const [row] = await db
    .insert(QBCustomers)
    .values({ ...baseCustomer, ...overrides })
    .returning()
  return row
}

const baseInvoiceSync: InferInsertModel<typeof QBInvoiceSync> = {
  portalId: TEST_PORTAL_ID,
  customerId: null,
  invoiceNumber: TEST_INVOICE_NUMBER,
  qbInvoiceId: TEST_QB_INVOICE_ID,
  qbSyncToken: '0',
  recipientId: TEST_CLIENT_ID,
  status: InvoiceStatus.OPEN,
}

export async function seedQBInvoiceSync(overrides: InvoiceSyncOverrides = {}) {
  const [row] = await db
    .insert(QBInvoiceSync)
    .values({ ...baseInvoiceSync, ...overrides })
    .returning()
  return row
}
