'use client'
import { AuthStatus } from '@/app/api/core/types/auth'
import { useApp } from '@/app/context/AppContext'
import { CalloutVariant } from '@/components/type/callout'
import { useQuickbooks } from '@/hook/useQuickbooks'
import { useEffect, useState } from 'react'

export const useDashboardMain = () => {
  const {
    token,
    tokenPayload,
    syncFlag,
    reconnect,
    lastSyncTimestamp,
    isEnabled,
    itemMapped,
  } = useApp()

  const { handleConnect, isReconnecting, handleSyncEnable } = useQuickbooks(
    token,
    tokenPayload,
    reconnect,
  )
  const [callOutStatus, setCallOutStatus] = useState<
    CalloutVariant.SUCCESS | CalloutVariant.ERROR | CalloutVariant.WARNING
  >(CalloutVariant.SUCCESS)
  const [isLoading, setIsLoading] = useState(true)
  const [buttonAction, setButtonAction] = useState<
    (() => Promise<void>) | undefined
  >(undefined)

  useEffect(() => {
    if (syncFlag) {
      if (!isEnabled) {
        setCallOutStatus(CalloutVariant.WARNING)
        setButtonAction(() => handleSyncEnable)
      } else {
        setCallOutStatus(CalloutVariant.SUCCESS)
      }
    } else {
      setCallOutStatus(CalloutVariant.ERROR)
      setButtonAction(() => () => handleConnect(AuthStatus.RECONNECT))
    }
    setIsLoading(false)
  }, [syncFlag, isEnabled])

  return {
    callOutStatus,
    isLoading,
    buttonAction,
    isReconnecting,
    lastSyncTimestamp,
    itemMapped,
  }
}
