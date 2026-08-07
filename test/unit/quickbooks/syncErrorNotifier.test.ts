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

const getInvoiceNumbersWithRecordedFeeMock = vi
  .fn()
  .mockResolvedValue(new Set<string>())
vi.mock('@/db/service/syncLog.service', () => ({
  getInvoiceNumbersWithRecordedFee: (
    portalId: string,
    invoiceNumbers: string[],
  ) => getInvoiceNumbersWithRecordedFeeMock(portalId, invoiceNumbers),
}))

import {
  SyncErrorNotifier,
  getActionForErrorCode,
  getEntityKey,
} from '@/app/api/quickbooks/syncLog/syncErrorNotifier'
import {
  AppActionableErrorCodes,
  PAYOUT_MIXED_INTENT_CODE,
  QBOErrorCodes,
  UserActionableErrorCodes,
} from '@/constant/intuitErrorCode'
import {
  getIEmailNotificationDetail,
  getInProductNotificationDetail,
} from '@/app/api/notification/notification.helper'

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
  errorMessage: 'Closed accounting period',
  errorCode: String(QBOErrorCodes.CLOSED_PERIOD),
  category: 'qb_api_error' as never,
  attempt: 0,
  shouldRetry: true,
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

  // Self-extending over the app-level sentinel registry, mirroring the QBO one.
  it.each(Object.entries(AppActionableErrorCodes))(
    'maps app sentinel code %s to action %s',
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
    getInvoiceNumbersWithRecordedFeeMock.mockReset()
    getInvoiceNumbersWithRecordedFeeMock.mockResolvedValue(new Set())
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

  it('suppresses 5010 stale-object on product (auto-recovers via updateProductSyncToken)', async () => {
    const notifier = new SyncErrorNotifier(user)
    await notifier.notify({
      ...baseLog,
      errorCode: '5010',
      entityType: 'product' as never,
      qbItemName: 'Widget',
    })
    expect(sendNotificationToIU).not.toHaveBeenCalled()
  })

  it('falls back to empty senderId when getPortalConnection returns null', async () => {
    getPortalConnectionMock.mockResolvedValueOnce(null)
    const notifier = new SyncErrorNotifier(user)
    await notifier.notify(baseLog)
    expect(sendNotificationToIU).toHaveBeenCalledTimes(1)
    const [senderId] = sendNotificationToIU.mock.calls[0]
    expect(senderId).toBe('')
  })

  it.each(['invoice', 'payment'] as const)(
    'dispatches 5010 stale-object on %s (no auto-recovery)',
    async (entityType) => {
      const notifier = new SyncErrorNotifier(user)
      await notifier.notify({
        ...baseLog,
        errorCode: '5010',
        entityType: entityType as never,
      })
      expect(sendNotificationToIU).toHaveBeenCalledTimes(1)
      const [, action] = sendNotificationToIU.mock.calls[0]
      expect(action).toBe(NotificationActions.QB_STALE_OBJECT)
    },
  )

  it('dispatches the mixed-payout notification for a FAILED payout with the sentinel code', async () => {
    const notifier = new SyncErrorNotifier(user)

    await notifier.notify({
      ...baseLog,
      entityType: 'payout' as never,
      eventType: 'settled' as never,
      errorCode: PAYOUT_MIXED_INTENT_CODE,
      quickbooksId: null,
      invoiceNumber: null,
      copilotId: 'po_test_1',
      // Webhook stashes the affected invoice numbers in remark for this action.
      remark: 'INV-A, INV-B',
      errorMessage:
        'Payout po_test_1 mixes batched and non-batched invoices; unsupported',
    })

    expect(sendNotificationToIU).toHaveBeenCalledTimes(1)
    const [, action, ctx] = sendNotificationToIU.mock.calls[0]
    expect(action).toBe(NotificationActions.QB_PAYOUT_MIXED_INTENT)
    // copilotId stays the ref; the invoice list rides in invoiceNumbers.
    expect(ctx).toMatchObject({
      entityType: 'payout',
      entityKey: 'po_test_1',
      invoiceNumbers: 'INV-A, INV-B',
    })
    // No recorded-fee rows this run, so the warning field stays absent.
    expect(ctx.invoiceNumbersWithFee).toBeUndefined()

    // Close the seam: the ctx extracted from `remark` must render the invoice
    // list in the real copy (both channels), with the payout id as the ref.
    const inProduct = getInProductNotificationDetail(action, ctx)
    const email = getIEmailNotificationDetail(action, ctx)
    for (const body of [inProduct.body, email.body]) {
      expect(body).toContain('ref po_test_1')
      expect(body).toContain('No deposit was created for invoices INV-A, INV-B')
    }
  })

  it('flags the invoices whose fees are already recorded so IUs do not book them twice', async () => {
    // Only INV-A has a recorded absorbed-fee expense; INV-B was deferred.
    getInvoiceNumbersWithRecordedFeeMock.mockResolvedValueOnce(
      new Set(['INV-A']),
    )
    const notifier = new SyncErrorNotifier(user)

    await notifier.notify({
      ...baseLog,
      entityType: 'payout' as never,
      eventType: 'settled' as never,
      errorCode: PAYOUT_MIXED_INTENT_CODE,
      quickbooksId: null,
      invoiceNumber: null,
      copilotId: 'po_test_1',
      remark: 'INV-A, INV-B',
      errorMessage:
        'Payout po_test_1 mixes batched and non-batched invoices; unsupported',
    })

    expect(getInvoiceNumbersWithRecordedFeeMock).toHaveBeenCalledWith(
      'portal-1',
      ['INV-A', 'INV-B'],
    )
    const [, action, ctx] = sendNotificationToIU.mock.calls[0]
    expect(ctx).toMatchObject({
      invoiceNumbers: 'INV-A, INV-B',
      invoiceNumbersWithFee: 'INV-A',
    })

    const inProduct = getInProductNotificationDetail(action, ctx)
    const email = getIEmailNotificationDetail(action, ctx)
    for (const body of [inProduct.body, email.body]) {
      expect(body).toContain(
        'The Stripe fees for INV-A are already recorded as expenses in QuickBooks, so do not record those fees again',
      )
    }
  })

  it('lists recorded-fee invoices in remark order, not lookup order', async () => {
    // Lookup returns them reversed; output must still follow the remark order.
    getInvoiceNumbersWithRecordedFeeMock.mockResolvedValueOnce(
      new Set(['INV-B', 'INV-A']),
    )
    const notifier = new SyncErrorNotifier(user)

    await notifier.notify({
      ...baseLog,
      entityType: 'payout' as never,
      eventType: 'settled' as never,
      errorCode: PAYOUT_MIXED_INTENT_CODE,
      copilotId: 'po_test_1',
      remark: 'INV-A, INV-B',
    })

    const [, , ctx] = sendNotificationToIU.mock.calls[0]
    expect(ctx.invoiceNumbersWithFee).toBe('INV-A, INV-B')
  })

  it('still dispatches the mixed-payout notification when the recorded-fee lookup throws', async () => {
    // A lookup blip must not swallow this terminal, never-retried notification.
    getInvoiceNumbersWithRecordedFeeMock.mockRejectedValueOnce(
      new Error('db blip'),
    )
    const notifier = new SyncErrorNotifier(user)

    await notifier.notify({
      ...baseLog,
      entityType: 'payout' as never,
      eventType: 'settled' as never,
      errorCode: PAYOUT_MIXED_INTENT_CODE,
      copilotId: 'po_test_1',
      remark: 'INV-A, INV-B',
    })

    expect(sendNotificationToIU).toHaveBeenCalledTimes(1)
    const [, action, ctx] = sendNotificationToIU.mock.calls[0]
    expect(action).toBe(NotificationActions.QB_PAYOUT_MIXED_INTENT)
    expect(ctx).toMatchObject({ invoiceNumbers: 'INV-A, INV-B' })
    expect(ctx.invoiceNumbersWithFee).toBeUndefined()
  })

  it('dispatches a notification for a FAILED row with a user-actionable code', async () => {
    const notifier = new SyncErrorNotifier(user)

    await notifier.notify(baseLog)

    expect(sendNotificationToIU).toHaveBeenCalledTimes(1)
    const [senderId, action, ctx] = sendNotificationToIU.mock.calls[0]
    expect(senderId).toBe('iu-1')
    expect(action).toBe(NotificationActions.QB_CLOSED_PERIOD)
    expect(ctx).toMatchObject({
      entityKey: 'INV-001',
      invoiceNumber: 'INV-001',
      eventType: 'created',
      errorMessage: 'Closed accounting period',
    })
  })
})
