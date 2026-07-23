import { vi, type Mock } from 'vitest'
import { AssemblyAPI } from '@/utils/assemblyAPI'
import IntuitAPI from '@/utils/intuitAPI'
import {
  TEST_INCOME_ACCOUNT_REF,
  TEST_COPILOT_INVOICE_ID,
  TEST_INVOICE_NUMBER,
  TEST_QB_PURCHASE_ID,
  TEST_QB_PAYMENT_ID,
  TEST_QB_INVOICE_ID,
} from './seed'

// Restricts override keys to the actual method names of the underlying class
// so typos produce a compile-time error. The Mock value type intentionally
// stays loose — tests routinely return shapes that don't match the real
// Promise return type.
type MockMethodOverrides<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown
    ? K
    : never]?: Mock
}

type AssemblyAPIOverrides = MockMethodOverrides<AssemblyAPI>
type IntuitAPIOverrides = MockMethodOverrides<IntuitAPI>

/**
 * Factory for a mocked AssemblyAPI instance.
 *
 * Tests mock the AssemblyAPI module with `vi.mock('@/utils/assemblyAPI')`, then
 * wire each `new AssemblyAPI(token)` call to an object produced by this factory.
 * Override any method via the `overrides` arg to tailor behavior per test.
 */
export function createMockAssemblyAPI(overrides: AssemblyAPIOverrides = {}) {
  return {
    getProduct: vi.fn().mockResolvedValue({
      id: '2cf93cf0-45fa-485f-b584-03c2c38a3999',
      name: 'Test Product',
      description: 'Test product description',
      status: 'active',
      createdAt: '2024-09-11T13:59:58.845233992Z',
      updatedAt: '2024-09-11T13:59:58.845233992Z',
    }),
    // --- invoice.created defaults (OUT-3708) ---
    getClient: vi.fn().mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      givenName: 'Jane',
      familyName: 'Doe',
      email: 'jane@example.com',
      companyId: '',
      status: 'active',
    }),
    getCompany: vi.fn().mockResolvedValue(undefined),
    getClients: vi.fn().mockResolvedValue({ data: [] }),
    getPrice: vi.fn().mockResolvedValue({
      id: 'C-wch-eSg',
      productId: '2cf93cf0-45fa-485f-b584-03c2c38a3999',
      amount: 60000,
      currency: 'usd',
      type: 'recurring',
    }),
    getPayments: vi.fn().mockResolvedValue({ data: [] }),
    // payment.succeeded needs a real invoice object to proceed past the getInvoice guard (OUT-3773)
    getInvoice: vi.fn().mockResolvedValue({
      id: TEST_COPILOT_INVOICE_ID,
      number: TEST_INVOICE_NUMBER,
    }),
    ...overrides,
  }
}

/**
 * Factory for a mocked IntuitAPI instance.
 *
 * Defaults represent the happy path for `product.created`:
 *  - getAnItem returns undefined (no existing item in QB)
 *  - getAnAccount returns an active income account matching the seeded ref
 *  - createItem returns a freshly-created QB item
 */
export function createMockIntuitAPI(overrides: IntuitAPIOverrides = {}) {
  return {
    getAnItem: vi.fn().mockResolvedValue(undefined),
    // Echo the id back so callers (checkAndUpdateAccountStatus) get the ref
    // they asked for; name-only queries fall back to the income account.
    // Name and AccountType are stubs — they don't vary by id because no
    // current caller inspects them. Parameterize if a future test does.
    getAnAccount: vi
      .fn()
      .mockImplementation(async (_name?: string, id?: string) => ({
        Id: id ?? TEST_INCOME_ACCOUNT_REF,
        Name: 'Sales of Product Income',
        SyncToken: '0',
        Active: true,
        AccountType: 'Income',
      })),
    createItem: vi.fn().mockResolvedValue({
      Id: '999',
      Name: 'Test Product',
      SyncToken: '0',
      UnitPrice: 600,
    }),
    // --- invoice.created defaults (OUT-3708) ---
    getACustomer: vi.fn().mockResolvedValue(undefined),
    getCustomerByEmail: vi.fn().mockResolvedValue(undefined),
    resolveUniqueCustomerName: vi
      .fn()
      .mockImplementation(async (n: string) => n),
    createCustomer: vi.fn().mockResolvedValue({
      Id: 'qb-cust-1',
      SyncToken: '0',
      DisplayName: 'Jane Doe',
      PrimaryEmailAddr: { Address: 'jane@example.com' },
      Active: true,
    }),
    customerSparseUpdate: vi.fn().mockResolvedValue({
      Id: 'qb-cust-1',
      SyncToken: '1',
      DisplayName: 'Jane Doe',
      PrimaryEmailAddr: { Address: 'jane@example.com' },
      Active: true,
    }),
    createInvoice: vi.fn().mockResolvedValue({
      Invoice: { Id: 'qb-inv-1', SyncToken: '0' },
    }),
    createPayment: vi.fn().mockResolvedValue({
      Payment: { Id: TEST_QB_PAYMENT_ID, SyncToken: '0' },
    }),
    // Handler ignores the response; it just needs the call to succeed (OUT-3921).
    voidInvoice: vi.fn().mockResolvedValue({
      Invoice: { Id: TEST_QB_INVOICE_ID, SyncToken: '1' },
    }),
    // invoice.deleted checks QBO first; null = the QBO-absent path.
    getInvoice: vi.fn().mockResolvedValue({
      Id: TEST_QB_INVOICE_ID,
      SyncToken: '0',
    }),
    deleteInvoice: vi.fn().mockResolvedValue({
      Invoice: { Id: TEST_QB_INVOICE_ID, status: 'Deleted' },
    }),
    createPurchase: vi.fn().mockResolvedValue({
      Purchase: { Id: TEST_QB_PURCHASE_ID, SyncToken: '0' },
    }),
    createDeposit: vi.fn().mockResolvedValue({
      Deposit: { Id: 'qb-deposit-1', SyncToken: '0' },
    }),
    deletePurchase: vi.fn().mockResolvedValue({
      Purchase: { Id: TEST_QB_PURCHASE_ID, status: 'Deleted' },
    }),
    // webhookInvoiceCreated pre-flights QBO for DocNumber collisions before
    // every createInvoice call (OUT-3710). Default to "no collisions" so the
    // base Assembly invoice number is used; override per-test to exercise the
    // suffix-walk path.
    findInvoicesByDocNumberPrefix: vi.fn().mockResolvedValue([]),
    getAccountsForProductMapping: vi.fn().mockResolvedValue({
      income: [],
      expense: [],
      asset: [],
    }),
    ...overrides,
  }
}

export type MockAssemblyAPI = ReturnType<typeof createMockAssemblyAPI>
export type MockIntuitAPI = ReturnType<typeof createMockIntuitAPI>

/**
 * Wires the module-mocked AssemblyAPI + IntuitAPI to shared instances and
 * returns them so tests can assert on calls. Uses `function` (not arrow) so
 * the mock is callable with `new`.
 *
 * Caveat: one request may `new AssemblyAPI(...)` several times (auth +
 * invoice flow) — all share this instance, so call counts sum across sites.
 */
export function installMockApis(
  opts: {
    copilot?: MockAssemblyAPI
    intuit?: MockIntuitAPI
  } = {},
): { copilot: MockAssemblyAPI; intuit: MockIntuitAPI } {
  const copilot = opts.copilot ?? createMockAssemblyAPI()
  const intuit = opts.intuit ?? createMockIntuitAPI()

  vi.mocked(AssemblyAPI).mockImplementation(function (
    this: unknown,
  ): AssemblyAPI {
    return copilot as unknown as AssemblyAPI
  } as unknown as typeof AssemblyAPI)

  vi.mocked(IntuitAPI).mockImplementation(function (this: unknown): IntuitAPI {
    return intuit as unknown as IntuitAPI
  } as unknown as typeof IntuitAPI)

  return { copilot, intuit }
}
