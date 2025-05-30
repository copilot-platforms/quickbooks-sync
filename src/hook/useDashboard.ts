'use client'
import { AuthStatus } from '@/app/api/core/types/auth'
import { useAuth } from '@/app/context/AuthContext'
import { CalloutVariant } from '@/components/type/callout'
import { useQuickbooks } from '@/hook/useQuickbooks'
import { useEffect, useState } from 'react'

export const useDashboardMain = () => {
  const { token, tokenPayload, syncFlag, reconnect, lastSyncTimestamp } =
    useAuth()

  const { handleConnect, isReconnecting } = useQuickbooks(
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
      setCallOutStatus(CalloutVariant.SUCCESS)
    } else {
      setCallOutStatus(CalloutVariant.ERROR)
    }
    setButtonAction(() => () => handleConnect(AuthStatus.RECONNECT))
    setIsLoading(false)
  }, [syncFlag])

  return {
    callOutStatus,
    isLoading,
    buttonAction,
    isReconnecting,
    lastSyncTimestamp,
  }
}
