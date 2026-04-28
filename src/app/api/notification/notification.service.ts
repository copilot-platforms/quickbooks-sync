import { BaseService } from '@/app/api/core/services/base.service'
import {
  NotificationActions,
  NotificationContext,
} from '@/app/api/core/types/notification'
import {
  NotificationCopy,
  getIEmailNotificationDetail,
  getInProductNotificationDetail,
} from '@/app/api/notification/notification.helper'
import { InternalUsersResponse } from '@/type/common'
import { CopilotAPI } from '@/utils/copilotAPI'
import CustomLogger from '@/utils/logger'
import { captureException, captureMessage } from '@sentry/nextjs'

// Notification actions whose recipients are the workspace's IUs. Derived
// directly from the keys of NotificationCopy so a new action can't accidentally
// be added to the helper without an IU recipient set — getAllParties returns
// `null` for any action missing here, which short-circuits dispatch.
const IU_RECIPIENT_ACTIONS = new Set<NotificationActions>(
  Object.keys(NotificationCopy) as NotificationActions[],
)

export class NotificationService extends BaseService {
  async createBulkNotification(
    action: NotificationActions,
    {
      disableEmail = false,
      disableInProduct = false,
      senderId,
      context,
    }: {
      disableEmail?: boolean
      disableInProduct?: boolean
      senderId: string
      context?: NotificationContext
    },
  ): Promise<void> {
    console.info(
      'NotificationService#createBulkNotification | Token: ',
      this.user.token,
    )
    try {
      const copilot = new CopilotAPI(this.user.token)
      // 1. get all parties that gets notification
      const parties = await this.getAllParties(copilot, action)

      if (parties) {
        const inProduct = disableInProduct
          ? undefined
          : getInProductNotificationDetail(action, context)

        const email = disableEmail
          ? undefined
          : getIEmailNotificationDetail(action, context)

        for (const party of parties.data) {
          CustomLogger.info({
            obj: { party },
            message: 'Sending notification to party: ',
          })
          const triggerNotification = await copilot.createNotification({
            recipientId: party.id,
            senderId,
            deliveryTargets: {
              inProduct,
              email,
            },
          })
          if (!triggerNotification) {
            console.error(
              `Failed to trigger notification for IUID: ${party.id}`,
            )
            captureMessage(
              `NotificationService#createBulkNotification | Copilot returned no notification`,
              {
                level: 'error',
                tags: {
                  key: 'notificationDispatchFailed',
                  action,
                  portalId: this.user.workspaceId,
                },
                extra: { recipientId: party.id, senderId },
              },
            )
          }
        }
      }
    } catch (error) {
      console.error(`Failed to send notification for action: ${action}`, {
        error,
      })
      captureException(error, {
        tags: {
          key: 'notificationDispatchFailed',
          action,
          portalId: this.user.workspaceId,
        },
        extra: { senderId },
      })
    }
  }

  async getAllParties(
    copilot: CopilotAPI,
    action: NotificationActions,
  ): Promise<InternalUsersResponse | null> {
    if (IU_RECIPIENT_ACTIONS.has(action)) {
      return await copilot.getInternalUsers()
    }
    return null
  }

  async sendNotificationToIU(
    senderId: string,
    action: NotificationActions,
    context?: NotificationContext,
  ): Promise<void> {
    await this.createBulkNotification(action, { senderId, context })
  }
}
