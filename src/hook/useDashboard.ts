import { AuthStatus } from '@/app/api/core/types/auth'
import { useAuth } from '@/app/context/AuthContext'
import { CalloutStatus } from '@/components/type/callout'
import { useQuickbooks } from '@/hook/useQuickbooks'
import { useEffect, useState } from 'react'

export const useDashboardMain = () => {
  const { token, tokenPayload, syncFlag, reconnect } = useAuth()

  const { handleConnect, isReconnecting } = useQuickbooks(
    token,
    tokenPayload,
    reconnect,
  )
  const [callOutStatus, setCallOutStatus] = useState(CalloutStatus.Success)
  const [isLoading, setIsLoading] = useState(true)
  const [buttonAction, setButtonAction] = useState<
    (() => Promise<void>) | undefined
  >(undefined)

  useEffect(() => {
    if (syncFlag) {
      setCallOutStatus(CalloutStatus.Success)
    } else {
      setCallOutStatus(CalloutStatus.Failed)
    }
    setButtonAction(() => () => handleConnect(AuthStatus.RECONNECT))
    setIsLoading(false)
  }, [syncFlag])

  return { callOutStatus, isLoading, buttonAction, isReconnecting }
}
