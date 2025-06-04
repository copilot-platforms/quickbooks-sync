'use client'
import SettingAccordion from '@/components/dashboard/settings/SettingAccordion'
import { CalloutVariant } from '@/components/type/callout'
import Divider from '@/components/ui/Divider'
import { useDashboardMain } from '@/hook/useDashboard'
import { useTimeAgo } from '@/hook/useTimeago'

import {
  ButtonProps,
  Callout,
  Heading,
  IconType,
  Spinner,
} from 'copilot-design-system'

type CalloutType = {
  title: string
  description?: string | React.ReactNode
  actionLabel?: string
  actionIcon?: IconType
  buttonDisabled?: boolean
  buttonVariant?: ButtonProps['variant']
}

const DashboardCallout = (lastSyncTime: string | null) => {
  const formattedTimeAgo = useTimeAgo(lastSyncTime)
  return {
    [CalloutVariant.WARNING]: {
      title: 'Confirm your mapping before getting started',
      description:
        "Set your product mappings and review configuration settings to best set up your QuickBooks integration. Once you're ready, click the button below to enable the app.",
      actionLabel: 'Enable app',
      actionIcon: 'Check' as IconType,
      buttonVariant: 'primary' as const,
    },
    [CalloutVariant.SUCCESS]: {
      title: 'QuickBooks sync is live',
      description: formattedTimeAgo ? `Last synced ${formattedTimeAgo}` : '',
    },
    [CalloutVariant.ERROR]: {
      title: 'Sync failed',
      description:
        'Please reauthorize your account to reconnect with QuickBooks.',
      actionLabel: 'Reauthorize',
      actionIcon: 'Repeat' as IconType,
      buttonVariant: 'secondary' as const,
    },
  }
}

export const Main = () => {
  const {
    callOutStatus: status,
    isLoading,
    buttonAction,
    isReconnecting,
    lastSyncTimestamp,
  } = useDashboardMain()

  const dashboardCallout: CalloutType =
    DashboardCallout(lastSyncTimestamp)[status]

  return (
    <>
      {isLoading ? (
        <Spinner size={5} />
      ) : (
        <>
          <Callout
            title={dashboardCallout.title}
            description={dashboardCallout.description}
            variant={status}
            {...(dashboardCallout.actionLabel && {
              actionProps: {
                label: isReconnecting
                  ? 'Reauthorizing...'
                  : dashboardCallout.actionLabel,
                onClick: buttonAction,
                disabled: isReconnecting,
                prefixIcon: dashboardCallout.actionIcon,
                ...(dashboardCallout.buttonVariant && {
                  variant: dashboardCallout.buttonVariant,
                }),
              },
            })}
          />
          <div className="mt-6 mb-2">
            <Heading
              size="xl"
              tag="h2"
              className="pb-4 border-b-1 border-b-card-divider !leading-7" // forcing styles with "!"
            >
              Settings
            </Heading>
            <Divider />
          </div>
          <SettingAccordion />
        </>
      )}
    </>
  )
}
