import { AuthStatus } from '@/app/api/core/types/auth'
import { NotificationActions } from '@/app/api/core/types/notification'

export const getInProductNotificationDetail = (): {
  [key in NotificationActions]: {
    title: string
    body: string
    ctaParams?: Record<string, unknown>
  }
} => {
  return {
    [NotificationActions.AUTH_RECONNECT]: {
      title: 'QuickBooks Sync has disconnected',
      body: 'Your QuickBooks Sync encountered an error and has stopped syncing. Please reconnect to avoid any disruptions.',
      ctaParams: { type: AuthStatus.RECONNECT },
    },
  }
}

export const getIEmailNotificationDetail = (): {
  [key in NotificationActions]: {
    title: string
    subject: string
    header: string
    body: string
    ctaParams?: Record<string, string>
  }
} => {
  return {
    [NotificationActions.AUTH_RECONNECT]: {
      title: 'Reconnect QuickBooks',
      subject: 'Your QuickBooks Sync has disconnected',
      header: 'QuickBooks Sync has disconnected',
      body: 'Your QuickBooks integration encountered an error and has stopped syncing. Please reconnect to avoid any disruptions.',
      ctaParams: { type: AuthStatus.RECONNECT }, // TODO: CTA params not working for email
    },
  }
}
