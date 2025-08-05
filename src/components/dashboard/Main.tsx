'use client'
import SettingAccordion from '@/components/dashboard/settings/SettingAccordion'
import { CalloutVariant } from '@/components/type/callout'
import Divider from '@/components/ui/Divider'
import { useDashboardMain } from '@/hook/useDashboard'

import {
  ButtonProps,
  Callout,
  Heading,
  IconType,
  Spinner,
} from 'copilot-design-system'
import LastSyncAt from '@/components/dashboard/LastSyncAt'
import { SilentError } from '@/components/template/SilentError'
import { useApp } from '@/app/context/AppContext'

type CalloutType = {
  title: string
  description?: string | React.ReactNode
  actionLabel?: string
  actionIcon?: IconType
  buttonDisabled?: boolean
  buttonVariant?: ButtonProps['variant']
}

const DashboardCallout = (lastSyncTime: string | null) => ({
  [CalloutVariant.WARNING]: {
    title: 'Finalize your integration',
    description:
      "Review your settings and product mappings to finalize the integration. Once you're ready, click the button to enable the sync.",
    actionLabel: 'Enable app',
    actionIcon: 'Check' as IconType,
    buttonVariant: 'primary' as const,
  },
  [CalloutVariant.SUCCESS]: {
    title: 'QuickBooks sync is live',
    description: <LastSyncAt date={lastSyncTime} />,
  },
  [CalloutVariant.ERROR]: {
    title: 'Sync failed',
    description:
      'Please reauthorize your account to reconnect with QuickBooks.',
    actionLabel: 'Reauthorize',
    actionIcon: 'Repeat' as IconType,
    buttonVariant: 'secondary' as const,
  },
  [CalloutVariant.INFO]: {
    title: 'Authorize your account',
    description: 'Log into QuickBooks with an admin account to get started.',
    actionLabel: 'Connect to QuickBooks',
    actionIcon: 'Check' as IconType,
    buttonVariant: 'primary' as const,
  },
})

export const Main = () => {
  const {
    callOutStatus: status,
    isLoading,
    buttonAction,
    isReconnecting,
    lastSyncTimestamp,
    portalConnectionStatus,
    syncFlag,
    handleConnect,
    isConnecting,
  } = useDashboardMain()

  const { enableAppIndicator } = useApp()

  if (portalConnectionStatus === null) {
    return (
      <SilentError
        message="Something went wrong while connecting to QuickBooks"
        resetFn={handleConnect}
      />
    )
  }

  const dashboardCallout: CalloutType =
    DashboardCallout(lastSyncTimestamp)[status]

  return (
    <>
      {isLoading ? (
        <div className="loading-spinner h-screen flex items-center justify-center">
          <Spinner size={10} />
        </div>
      ) : (
        <main className="main-section px-8 sm:px-[100px] lg:px-[220px] pb-[54px] pt-6">
          <Callout
            title={dashboardCallout.title}
            description={dashboardCallout.description}
            variant={status}
            {...(dashboardCallout.actionLabel && {
              actionProps: {
                label:
                  isReconnecting || isConnecting
                    ? 'Connecting...'
                    : dashboardCallout.actionLabel,
                onClick: buttonAction,
                disabled:
                  isReconnecting ||
                  isConnecting ||
                  (status === CalloutVariant.WARNING && !enableAppIndicator),
                prefixIcon: dashboardCallout.actionIcon,
                ...(dashboardCallout.buttonVariant && {
                  variant: dashboardCallout.buttonVariant,
                }),
                className: !portalConnectionStatus ? 'lg:!px-8' : '',
              },
            })}
          />
          <div className={!portalConnectionStatus ? 'opacity-25 relative' : ''}>
            {!portalConnectionStatus && (
              <div className="absolute top-0 left-0 w-full h-full z-10"></div>
            )}
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
            <SettingAccordion syncFlag={syncFlag} />
          </div>
        </main>
      )}
    </>
  )
}
