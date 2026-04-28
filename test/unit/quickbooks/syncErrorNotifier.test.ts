import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LogStatus } from '@/app/api/core/types/log'
import { NotificationActions } from '@/app/api/core/types/notification'
import { QBSyncLogSelectSchemaType } from '@/db/schema/qbSyncLogs'

// Stub Sentry + logger before importing the SUT — its transitive imports pull
// in CopilotAPI/IntuitAPI which try to construct real SDK clients at import time.
vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}))

const sendNotificationToIU = vi.fn()
vi.mock('@/app/api/notification/notification.service', () => ({
  // Must be a real constructable class — the SUT calls `new NotificationService(...)`.
  NotificationService: class {
    sendNotificationToIU = sendNotificationToIU
  },
}))

vi.mock('@/db', () => ({
  db: {},
  client: {},
}))

const getPortalConnectionMock = vi
  .fn()
  .mockResolvedValue({ intiatedBy: 'iu-1' })
vi.mock('@/db/service/token.service', () => ({
  getPortalConnection: () => getPortalConnectionMock(),
}))

import {
  SyncErrorNotifier,
  getActionForErrorCode,
  getEntityKey,
} from '@/app/api/quickbooks/syncLog/syncErrorNotifier'
import { UserActionableErrorCodes } from '@/constant/intuitErrorCode'

const baseLog: QBSyncLogSelectSchemaType = {
  id: 'log-1',
  portalId: 'portal-1',
  entityType: 'invoice' as never,
  eventType: 'created' as never,
  status: LogStatus.FAILED as never,
  syncAt: null,
  copilotId: 'copilot-1',
  quickbooksId: null,
  invoiceNumber: 'INV-001',
  amount: null,
  remark: null,
  customerName: null,
  customerEmail: null,
  taxAmount: null,
  feeAmount: null,
  productName: null,
  productPrice: null,
  qbItemName: null,
  copilotPriceId: null,
  errorMessage: 'Duplicate Document Number Error',
  errorCode: '6140',
  category: 'qb_api_error' as never,
  attempt: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}

describe('getActionForErrorCode', () => {
  // Iterating Object.entries makes this test self-extending — any new code
  // added to UserActionableErrorCodes is automatically asserted, and any
  // mapping change here will fail this test loudly.
  it.each(Object.entries(UserActionableErrorCodes))(
    'maps registry code %s to action %s',
    (code, expectedAction) => {
      expect(getActionForErrorCode(code)).toBe(expectedAction)
    },
  )

  it('returns null for unknown / transient / auth codes', () => {
    expect(getActionForErrorCode('429')).toBeNull()
    expect(getActionForErrorCode('500')).toBeNull()
    expect(getActionForErrorCode('120')).toBeNull()
    expect(getActionForErrorCode('999')).toBeNull()
  })

  it('returns null for empty / nullish input', () => {
    expect(getActionForErrorCode(undefined)).toBeNull()
    expect(getActionForErrorCode(null)).toBeNull()
    expect(getActionForErrorCode('')).toBeNull()
  })
})

describe('getEntityKey', () => {
  it('prefers quickbooksId when present', () => {
    expect(
      getEntityKey({
        ...baseLog,
        quickbooksId: 'qb-42',
        invoiceNumber: 'INV-001',
      }),
    ).toBe('qb-42')
  })

  it('falls through to invoiceNumber, then qbItemName, then copilotPriceId, then copilotId', () => {
    expect(
      getEntityKey({
        ...baseLog,
        quickbooksId: null,
        invoiceNumber: 'INV-002',
      }),
    ).toBe('INV-002')

    expect(
      getEntityKey({
        ...baseLog,
        quickbooksId: null,
        invoiceNumber: null,
        qbItemName: 'Widget',
      }),
    ).toBe('Widget')

    expect(
      getEntityKey({
        ...baseLog,
        quickbooksId: null,
        invoiceNumber: null,
        qbItemName: null,
        copilotPriceId: 'price-x',
      }),
    ).toBe('price-x')

    expect(
      getEntityKey({
        ...baseLog,
        quickbooksId: null,
        invoiceNumber: null,
        qbItemName: null,
        copilotPriceId: null,
        copilotId: 'co-fallback',
      }),
    ).toBe('co-fallback')
  })

  it('returns empty string when no identifier is present', () => {
    expect(
      getEntityKey({
        ...baseLog,
        quickbooksId: null,
        invoiceNumber: null,
        qbItemName: null,
        copilotPriceId: null,
        copilotId: '',
      }),
    ).toBe('')
  })
})

describe('SyncErrorNotifier#notify', () => {
  const user = {
    token: 'tok',
    workspaceId: 'portal-1',
    role: 'iu' as never,
  } as never

  beforeEach(() => {
    sendNotificationToIU.mockReset()
  })

  it('skips when status is not FAILED', async () => {
    const notifier = new SyncErrorNotifier(user)
    await notifier.notify({ ...baseLog, status: LogStatus.SUCCESS as never })
    expect(sendNotificationToIU).not.toHaveBeenCalled()
  })

  it('skips when errorCode does not map to a user-actionable action', async () => {
    const notifier = new SyncErrorNotifier(user)
    await notifier.notify({ ...baseLog, errorCode: '429' })
    expect(sendNotificationToIU).not.toHaveBeenCalled()
  })

  it.each(['product', 'customer', 'payment'] as const)(
    'suppresses 5010 stale-object on %s (auto-recovers via syncToken refresh)',
    async (entityType) => {
      sendNotificationToIU.mockReset()
      const notifier = new SyncErrorNotifier(user)
      await notifier.notify({
        ...baseLog,
        errorCode: '5010',
        entityType: entityType as never,
        qbItemName: 'Widget',
      })
      expect(sendNotificationToIU).not.toHaveBeenCalled()
    },
  )

  it('falls back to empty senderId when getPortalConnection returns null', async () => {
    getPortalConnectionMock.mockResolvedValueOnce(null)
    const notifier = new SyncErrorNotifier(user)
    await notifier.notify(baseLog)
    expect(sendNotificationToIU).toHaveBeenCalledTimes(1)
    const [senderId] = sendNotificationToIU.mock.calls[0]
    expect(senderId).toBe('')
  })

  it('still dispatches 5010 stale-object on invoices (no auto-recovery)', async () => {
    const notifier = new SyncErrorNotifier(user)
    await notifier.notify({
      ...baseLog,
      errorCode: '5010',
      entityType: 'invoice' as never,
    })
    expect(sendNotificationToIU).toHaveBeenCalledTimes(1)
    const [, action] = sendNotificationToIU.mock.calls[0]
    expect(action).toBe(NotificationActions.QB_STALE_OBJECT)
  })

  it('dispatches a notification for a FAILED row with a user-actionable code', async () => {
    const notifier = new SyncErrorNotifier(user)

    await notifier.notify(baseLog)

    expect(sendNotificationToIU).toHaveBeenCalledTimes(1)
    const [senderId, action, ctx] = sendNotificationToIU.mock.calls[0]
    expect(senderId).toBe('iu-1')
    expect(action).toBe(NotificationActions.QB_DUPLICATE_DOC_NUMBER)
    expect(ctx).toMatchObject({
      entityKey: 'INV-001',
      invoiceNumber: 'INV-001',
      eventType: 'created',
      errorMessage: 'Duplicate Document Number Error',
    })
  })
})
