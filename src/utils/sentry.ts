import * as Sentry from '@sentry/nextjs'

export function addSyncBreadcrumb(
  message: string,
  data?: Record<string, string | number | boolean | undefined>,
) {
  Sentry.addBreadcrumb({
    category: 'sync',
    message,
    data,
    level: 'info',
  })
}

export function captureSyncError(
  error: unknown,
  tags: Record<string, string>,
  extra?: Record<string, string | number | boolean | undefined>,
) {
  Sentry.captureException(error, { tags, extra })
}
