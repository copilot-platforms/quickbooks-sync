import { BaseService } from '@/app/api/core/services/base.service'
import { NotificationActions } from '@/app/api/core/types/notification'
import {
  getIEmailNotificationDetail,
  getInProductNotificationDetail,
} from '@/app/api/notification/notification.helper'
import { InternalUsersResponse } from '@/type/common'
import { CopilotAPI } from '@/utils/copilotAPI'
import CustomLogger from '@/utils/logger'

export class NotificationService extends BaseService {
  async createBulkNotification(
    action: NotificationActions,
    {
      disableEmail = false,
      disableInProduct = false,
      senderId,
    }: {
      disableEmail?: boolean
      disableInProduct?: boolean
      senderId: string
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
          : getInProductNotificationDetail()[action]

        const email = disableEmail
          ? undefined
          : getIEmailNotificationDetail()[action]

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
          }
        }
      }
    } catch (error) {
      console.error(`Failed to send notification for action: ${action}`, {
        error,
      })
    }
  }

  async getAllParties(
    copilot: CopilotAPI,
    action: NotificationActions,
  ): Promise<InternalUsersResponse | null> {
    switch (action) {
      case NotificationActions.AUTH_RECONNECT:
        return await copilot.getInternalUsers()
      default:
        return null
    }
  }

  async sendNotificationToIU(
    senderId: string,
    action: NotificationActions,
  ): Promise<void> {
    await this.createBulkNotification(action, { senderId })
  }
}
