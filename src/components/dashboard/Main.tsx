'use client'
import { Callout, CalloutType } from '@/components/template/Callout'
import { CalloutStatus } from '@/components/type/callout'
import { useDashboardMain } from '@/hook/useDashboard'
import { Spinner } from 'copilot-design-system'

const DashboardCallout = {
  [CalloutStatus.Warning]: {
    label: 'Confirm your mapping before getting started',
    body: "Set your product mappings and review configuration settings to best set up your QuickBooks integration. Once you're ready, click the button below to enable the app.",
    buttonText: 'Enable app',
  },
  [CalloutStatus.Success]: {
    label: 'QuickBooks sync is on',
  },
  [CalloutStatus.Info]: {
    label: 'This is an info',
  },
  [CalloutStatus.Failed]: {
    label: 'QuickBooks sync is off',
    body: 'Please reauthorize your account to reconnect with QuickBooks.',
    buttonText: 'Reauthorize',
  },
}

export const Main = () => {
  const {
    callOutStatus: status,
    isLoading,
    buttonAction,
    isReconnecting,
  } = useDashboardMain()

  const dashboardCallout: CalloutType = DashboardCallout[status]

  return (
    <>
      {isLoading ? (
        <Spinner size={5} />
      ) : (
        <Callout
          label={dashboardCallout.label}
          body={dashboardCallout.body}
          {...(dashboardCallout.buttonText && {
            buttonText: isReconnecting
              ? 'Reauthorizing...'
              : dashboardCallout.buttonText,
            onButtonClick: buttonAction,
            buttonDisabled: isReconnecting,
          })}
          buttonIcon={dashboardCallout.buttonIcon}
          status={status}
        />
      )}
    </>
  )
}
