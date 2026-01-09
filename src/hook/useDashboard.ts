'use client'
import { checkForNonUsCompany } from '@/action/quickbooks.action'
import { AuthStatus } from '@/app/api/core/types/auth'
import { useApp } from '@/app/context/AppContext'
import { CalloutVariant } from '@/components/type/callout'
import { getPortalTokens } from '@/db/service/token.service'
import { useQuickbooks } from '@/hook/useQuickbooks'
import { useCallback, useEffect, useState } from 'react'

export const useDashboardMain = () => {
  const {
    token,
    tokenPayload,
    syncFlag,
    reconnect,
    lastSyncTimestamp,
    isEnabled,
    portalConnectionStatus,
    qbTokens,
    setAppParams,
  } = useApp()

  const {
    handleConnect,
    isReconnecting,
    handleSyncEnable,
    loading: isConnecting,
  } = useQuickbooks(token, tokenPayload, reconnect)

  const [callOutStatus, setCallOutStatus] = useState<
    | CalloutVariant.SUCCESS
    | CalloutVariant.ERROR
    | CalloutVariant.WARNING
    | CalloutVariant.INFO
  >(CalloutVariant.SUCCESS)
  const [isLoading, setIsLoading] = useState(true)
  const [buttonAction, setButtonAction] = useState<
    (() => Promise<NodeJS.Timeout>) | undefined
  >(undefined)
  const [nonUsCompanyChecking, setNonUsCompanyChecking] = useState(false)

  const checkCompanyCountry = useCallback(async () => {
    setNonUsCompanyChecking(true)
    let tempTokenInfo = qbTokens
    if (!tempTokenInfo) {
      tempTokenInfo = await getPortalTokens(tokenPayload.workspaceId)
    }

    const nonUsCompany = await checkForNonUsCompany(tempTokenInfo)
    setAppParams((prev) => ({
      ...prev,
      qbTokens: tempTokenInfo,
      nonUsCompany,
    }))
    setNonUsCompanyChecking(false)
  }, [syncFlag])

  useEffect(() => {
    if (syncFlag) {
      checkCompanyCountry()
    }
  }, [syncFlag])

  useEffect(() => {
    let timeout: NodeJS.Timeout
    if (!portalConnectionStatus) {
      // No early return to run timeout cleanup function
      setCallOutStatus(CalloutVariant.INFO)
      setButtonAction(() => async () => {
        timeout = await handleConnect()
        return timeout
      })
    } else {
      if (syncFlag) {
        if (!isEnabled) {
          setCallOutStatus(CalloutVariant.WARNING)
          setButtonAction(() => handleSyncEnable)
        } else {
          setCallOutStatus(CalloutVariant.SUCCESS)
        }
      } else {
        setCallOutStatus(CalloutVariant.ERROR)
        setButtonAction(() => async () => {
          timeout = await handleConnect(AuthStatus.RECONNECT)
          return timeout
        })
      }
    }
    setIsLoading(false)
    return () => clearTimeout(timeout)
  }, [syncFlag, isEnabled])

  return {
    callOutStatus,
    isLoading,
    buttonAction,
    isReconnecting,
    lastSyncTimestamp,
    portalConnectionStatus,
    syncFlag,
    isConnecting,
    handleConnect,
    nonUsCompanyChecking,
  }
}
