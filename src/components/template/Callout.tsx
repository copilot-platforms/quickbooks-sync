import { Body, Button, Heading, Icon, IconType } from 'copilot-design-system'
import { clsx } from 'clsx'
import { CalloutStatus } from '@/components/type/callout'

export type CalloutType = {
  label: string
  body?: string
  buttonText?: string
  buttonIcon?: IconType
  buttonDisabled?: boolean
}

type CalloutProps = {
  status: CalloutStatus
  onButtonClick?: () => void
} & CalloutType

const statusConfig = {
  warning: {
    bg: 'bg-warning-background',
    icon: <Icon icon="Warning" width={16} height={16} />,
    iconColor: 'text-warning-primary',
  },
  success: {
    bg: 'bg-success-background',
    icon: <Icon icon="Success" width={16} height={16} />,
    iconColor: 'text-success-primary',
  },
  info: {
    bg: 'bg-info-background',
    icon: <Icon icon="Info" width={16} height={16} />,
    iconColor: 'text-info-primary',
  },
  failed: {
    bg: 'bg-failed-background',
    icon: <Icon icon="Failed" width={16} height={16} />,
    iconColor: 'text-failed-primary',
  },
}

export const Callout = ({
  status,
  label,
  body,
  buttonText,
  onButtonClick,
  buttonIcon,
  buttonDisabled = false,
}: CalloutProps) => {
  const { bg, icon: IconComponent, iconColor } = statusConfig[status]

  return (
    <div className={clsx('w-full rounded-lg p-4 md:p-5', bg)}>
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-start gap-3">
          <div className={clsx('mt-1', iconColor)}>{IconComponent}</div>
          <div className="space-y-1 text-left">
            <Heading size="base">{label}</Heading>
            {body && <Body>{body}</Body>}
          </div>
        </div>
        {buttonText && (
          <div className="w-full sm:w-auto">
            <Button
              label={buttonText}
              onClick={onButtonClick}
              {...(buttonIcon && { prefixIcon: buttonIcon })}
              disabled={buttonDisabled}
            />
          </div>
        )}
      </div>
    </div>
  )
}
