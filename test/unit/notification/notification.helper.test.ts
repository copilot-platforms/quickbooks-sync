import { describe, it, expect } from 'vitest'
import {
  NotificationActions,
  NotificationContext,
} from '@/app/api/core/types/notification'
import {
  getIEmailNotificationDetail,
  getInProductNotificationDetail,
} from '@/app/api/notification/notification.helper'

const SYNC_FAILURE_ACTIONS = [
  NotificationActions.QB_DUPLICATE_DOC_NUMBER,
  NotificationActions.QB_DUPLICATE_NAME,
  NotificationActions.QB_CLOSED_PERIOD,
  NotificationActions.QB_DEPOSITED_TXN_LOCKED,
  NotificationActions.QB_INACTIVE_REFERENCE,
  NotificationActions.QB_SUBSCRIPTION_INVALID,
  NotificationActions.QB_VALIDATION_FAILED,
  NotificationActions.QB_STALE_OBJECT,
  NotificationActions.QB_TXN_LINK_FAILED,
  NotificationActions.QB_ITEM_INCOME_ACCOUNT_MISSING,
] as const

describe('getInProductNotificationDetail', () => {
  it('returns the existing AUTH_RECONNECT copy unchanged when called without context', () => {
    // Backwards-compat guard: the AUTH_RECONNECT call site (auth.service.ts)
    // never passes context; that path must keep working byte-for-byte.
    const detail = getInProductNotificationDetail(
      NotificationActions.AUTH_RECONNECT,
    )
    expect(detail.title).toBe('QuickBooks Sync has disconnected')
    expect(detail.body).toContain('reconnect')
    expect(detail.ctaParams).toEqual({ type: 'reconnect' })
  })

  it.each(SYNC_FAILURE_ACTIONS)(
    'returns a non-empty title and body for %s',
    (action) => {
      const detail = getInProductNotificationDetail(action)
      expect(detail.title.length).toBeGreaterThan(0)
      expect(detail.body.length).toBeGreaterThan(0)
    },
  )

  it('omits the entity reference clause when called without context (AUTH_RECONNECT path)', () => {
    const detail = getInProductNotificationDetail(
      NotificationActions.QB_DUPLICATE_DOC_NUMBER,
    )
    expect(detail.body).not.toMatch(/\(during|ref /)
  })

  it('renders the full action + ref clause for invoice void', () => {
    const ctx: NotificationContext = {
      entityType: 'invoice',
      eventType: 'voided',
      invoiceNumber: 'INV-9',
    }
    const detail = getInProductNotificationDetail(
      NotificationActions.QB_STALE_OBJECT,
      ctx,
    )
    expect(detail.body).toContain('during invoice void, ref INV-9')
  })

  it('renders the full action + ref clause for product update with qbItemName', () => {
    const ctx: NotificationContext = {
      entityType: 'product',
      eventType: 'updated',
      qbItemName: 'Widget A',
    }
    const detail = getInProductNotificationDetail(
      NotificationActions.QB_VALIDATION_FAILED,
      ctx,
    )
    expect(detail.body).toContain('during product update, ref Widget A')
  })

  it('5010 (invoice-only after suppression) warns that the failure is final', () => {
    const ctx: NotificationContext = {
      entityType: 'invoice',
      eventType: 'updated',
      invoiceNumber: 'INV-77',
    }
    const detail = getInProductNotificationDetail(
      NotificationActions.QB_STALE_OBJECT,
      ctx,
    )
    expect(detail.body).toMatch(/voided|deleted/)
    expect(detail.body).toMatch(/cannot recover|final/)
  })

  it('6240 product copy frames the conflict as item-vs-item only (no cross-namespace, no 20-variant claim)', () => {
    const ctx: NotificationContext = {
      entityType: 'product',
      eventType: 'created',
      qbItemName: 'Widget A',
    }
    const detail = getInProductNotificationDetail(
      NotificationActions.QB_DUPLICATE_NAME,
      ctx,
    )
    expect(detail.body).toContain("item's name")
    // QBO Items live in their own namespace — they don't collide with the
    // Customer/Vendor/Employee shared name list. Guard against regression.
    expect(detail.body).not.toMatch(/Customer|Vendor|Employee/)
    expect(detail.body).not.toContain('20 numbered variations')
  })

  it('6240 invoice/customer copy mentions the 20-variant fallback', () => {
    const ctx: NotificationContext = {
      entityType: 'invoice',
      eventType: 'created',
      customerName: 'Acme Inc',
    }
    const detail = getInProductNotificationDetail(
      NotificationActions.QB_DUPLICATE_NAME,
      ctx,
    )
    expect(detail.body).toContain('20 numbered variations')
  })
})

describe('getIEmailNotificationDetail', () => {
  it('returns the existing AUTH_RECONNECT copy unchanged when called without context', () => {
    const detail = getIEmailNotificationDetail(
      NotificationActions.AUTH_RECONNECT,
    )
    expect(detail.subject).toBe('Your QuickBooks Sync has disconnected')
    expect(detail.header).toBe('QuickBooks Sync has disconnected')
    expect(detail.ctaParams).toEqual({ type: 'reconnect' })
  })

  it.each(SYNC_FAILURE_ACTIONS)(
    'returns non-empty subject/header/body for %s',
    (action) => {
      const detail = getIEmailNotificationDetail(action)
      expect(detail.subject.length).toBeGreaterThan(0)
      expect(detail.header.length).toBeGreaterThan(0)
      expect(detail.body.length).toBeGreaterThan(0)
    },
  )

  it('renders the full action + ref clause for customer create', () => {
    const ctx: NotificationContext = {
      entityType: 'invoice',
      eventType: 'created',
      customerName: 'Acme Inc',
    }
    const detail = getIEmailNotificationDetail(
      NotificationActions.QB_DUPLICATE_NAME,
      ctx,
    )
    expect(detail.body).toContain('during invoice creation, ref Acme Inc')
  })
})
