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
    [NotificationActions.AuthReconnect]: {
      title: 'QuickBooks Integration Has Stopped Working',
      body: 'Your QuickBooks integration encountered an error and has stopped syncing. Please reconnect to avoid any disruptions.',
      ctaParams: { type: AuthStatus.Reconnect },
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
    [NotificationActions.AuthReconnect]: {
      title: 'Reconnect QuickBooks',
      subject: 'Your QuickBooks Sync has stopped working',
      header: 'Regarding QuickBooks sync off',
      body: 'Your QuickBooks integration encountered an error and has stopped syncing. Please reconnect to avoid any disruptions.',
      ctaParams: { type: AuthStatus.Reconnect }, // TODO: CTA params not working for email
    },
  }
}
