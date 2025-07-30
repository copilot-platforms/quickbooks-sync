import { AuthStatus } from '@/app/api/core/types/auth'
import { LogStatus } from '@/app/api/core/types/log'
import { useApp } from '@/app/context/AppContext'
import { Icons, useActionsMenu } from '@/bridge/header'
import { copilotDashboardUrl } from '@/config'
import { ConnectionStatus } from '@/db/schema/qbConnectionLogs'
import { postFetcher } from '@/helper/fetch.helper'
import SupabaseClient from '@/lib/supabase'
import { Token } from '@/type/common'
import { useEffect, useState } from 'react'

export const useQuickbooks = (
  token: string,
  tokenPayload: Token,
  reconnect: boolean,
) => {
  const [loading, setLoading] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(reconnect)
  const { setAppParams, portalConnectionStatus } = useApp()

  useEffect(() => {
    const supabase = SupabaseClient.getInstance()
    const realtimeSyncChannel = supabase
      .channel('realtime sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'qb_settings',
          filter: `portal_id=eq.${tokenPayload?.workspaceId}`,
        },
        (payload) => {
          // TODO: parsing payload using drizzle-zod throwing error
          // const parsedPayload = QBPortalConnectionSelectSchema.parse(payload.new)
          setAppParams((prev) => ({
            ...prev,
            syncFlag: payload.new.sync_flag,
            isEnabled: payload.new.is_enabled,
          }))
          setLoading(false)
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'qb_connection_logs',
          filter: `portal_id=eq.${tokenPayload?.workspaceId}`,
        },
        (payload) => {
          const newPayload = payload.new // TODO: parsing payload using drizzle-zod throwing error
          const connectionStatus =
            newPayload.connection_status === ConnectionStatus.SUCCESS
              ? true
              : newPayload.connection_status === ConnectionStatus.PENDING
                ? false
                : null

          setIsReconnecting(!connectionStatus)
          setAppParams((prev) => ({
            ...prev,
            syncFlag: connectionStatus || false,
            lastSyncTimestamp: connectionStatus
              ? newPayload.updated_at
              : prev.lastSyncTimestamp,
            portalConnectionStatus: connectionStatus,
          }))
          setLoading(false)
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'qb_sync_logs',
          filter: `portal_id=eq.${tokenPayload?.workspaceId}`,
        },
        (payload) => {
          const newPayload = payload.new
          const isSuccess =
            newPayload.status === LogStatus.SUCCESS ? true : false
          setAppParams((prev) => ({
            ...prev,
            lastSyncTimestamp: isSuccess
              ? newPayload.updated_at
              : prev.lastSyncTimestamp,
          }))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(realtimeSyncChannel)
    }
  }, [])

  // handle reconnect logic
  useEffect(() => {
    const handleAppConnect = async () => {
      const timeout = await handleConnect(AuthStatus.RECONNECT)
      return () => clearTimeout(timeout)
    }

    if (reconnect) {
      handleAppConnect()
    }
  }, [reconnect])

  const getAuthUrl = async (type?: string) => {
    setLoading(true)
    const redirectUrl = copilotDashboardUrl
    const url = `/api/quickbooks/auth?token=${token}${type ? `&type=${type}` : ''}`
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ redirectUrl }),
    })
    return await response.json()
  }

  const handleConnect = async (type?: string) => {
    // set time-out in case if user closes the popped up window. This will prevent the app from the infinite "connecting" state
    const timeout = setTimeout(() => {
      if (!portalConnectionStatus) {
        setLoading(false)
      }
    }, 120000) // timeout after 2 minutes

    const authUrl = await getAuthUrl(type)
    if (authUrl) window.open(authUrl, '_blank')

    return timeout
  }

  const handleSyncEnable = async () => {
    try {
      const enable = true
      const url = `/api/quickbooks/token/change-enable-status?token=${token}`
      setLoading(true)
      const response = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ enable }),
      })

      const res = await response.json()
      setLoading(false)
      return res
    } catch (e) {
      setLoading(false)
      console.error('Error: ', e)
    }
  }

  const checkPortalConnection = async () => {
    const response = await fetch(
      `/api/quickbooks/token/check-connection?token=${token}`,
    )
    const data = await response.json()
    setAppParams((prev) => ({
      ...prev,
      portalConnectionStatus: data && Object.keys(data).length > 0,
    }))
  }

  return {
    loading,
    handleConnect,
    checkPortalConnection,
    isReconnecting,
    handleSyncEnable,
  }
}

export const useQuickbooksCallback = () => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const realmId = params.get('realmId')
    const state = params.get('state')
    const redirectError = params.get('error')

    if (redirectError && state) {
      const errorhandler = async () => {
        await handleError(redirectError, state)

        // auto close the current window after 5 seconds
        const timeout = setTimeout(() => {
          window.close()
        }, 5000)

        return () => clearTimeout(timeout)
      }

      errorhandler()
    }

    if (code && realmId && state) {
      const tokenExchange = async () => {
        const timeout = await handleTokenExchange(
          {
            code,
            realmId,
          },
          state,
        )
        return () => clearTimeout(timeout)
      }

      tokenExchange()
    }
  }, [])

  const handleError = async (errorMessage: string, state: string) => {
    setLoading(true)
    const parsedState = JSON.parse(state)
    const token = parsedState.token
    setError(`Cannot connect to QuickBooks. Reason: "${errorMessage}"`)
    const res = await fetch(
      `/api/quickbooks/auth/connection-error?token=${token}`,
      {
        method: 'POST',
      },
    )
    setLoading(false)
    if (!res.ok) {
      setError('Error connecting to QuickBooks')
      return
    }
  }

  const handleTokenExchange = async (
    body: {
      code: string
      realmId: string
    },
    state: string,
  ) => {
    setLoading(true)
    const parsedState = JSON.parse(state)
    const token = parsedState.token
    const res = await fetch(
      `/api/quickbooks/auth/token-exchange?token=${token}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    )

    setLoading(false)
    if (!res.ok) {
      setError('Error connecting to QuickBooks')
      return
    }

    // auto close the current window after 2 seconds
    return setTimeout(() => {
      window.close()
    }, 2000)
  }

  return { loading, error }
}

export const useAppBridge = ({
  token,
  isEnabled,
  syncFlag,
  connectionStatus,
}: {
  token: string
  isEnabled: boolean | null
  syncFlag: boolean
  connectionStatus: boolean
}) => {
  const disconnectAction = async () => {
    const payload = {
      enable: false,
    }
    const url = `/api/quickbooks/token/change-enable-status?token=${token}`
    await postFetcher(url, {}, payload)
  }

  const downloadCsvAction = async () => {
    const url = `/api/quickbooks/syncLog/download?token=${token}`
    const link = document.createElement('a')
    link.href = url
    link.download = 'sync-history.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }
  let actions: { label: string; icon?: Icons; onClick: () => Promise<void> }[] =
    []
  if (connectionStatus) {
    actions = [
      {
        label: 'Download sync history',
        icon: 'Download',
        onClick: downloadCsvAction,
      },
    ]

    if (isEnabled && syncFlag) {
      actions.push({
        label: 'Disconnect app',
        icon: 'Disconnected',
        onClick: disconnectAction,
      })
    }
  }
  useActionsMenu(actions)
}
