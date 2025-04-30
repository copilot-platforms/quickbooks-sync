import { AuthStatus } from '@/app/api/core/types/auth'
import { copilotDashboardUrl } from '@/config'
import { ConnectionStatus } from '@/db/schema/qbConnectionLogs'
import SupabaseClient from '@/lib/supabase'
import { Token } from '@/type/common'
import { useEffect, useState } from 'react'

export const useQuickbooks = (
  token: string,
  tokenPayload: Token,
  syncFlag: boolean,
  reconnect: boolean,
) => {
  const [loading, setLoading] = useState(false)
  const [hasConnection, setHasConnection] = useState<boolean | null>(false) // null indicates error
  const [isSyncOn, setIsSyncOn] = useState(syncFlag)
  const [isReconnecting, setIsReconnecting] = useState(reconnect)

  useEffect(() => {
    const supabase = SupabaseClient.getInstance()
    const realtimeSyncChannel = supabase
      .channel('realtime sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'qb_tokens',
          filter: `portal_id=eq.${tokenPayload?.workspaceId}`,
        },
        (payload) => {
          // TODO: parsing payload using drizzle-zod throwing error
          // const parsedPayload = QBTokenSelectSchema.parse(payload.new)
          setIsSyncOn(payload.new.sync_flag)
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
          setHasConnection(connectionStatus)
          setIsReconnecting(!connectionStatus)
          setIsSyncOn(connectionStatus || false)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(realtimeSyncChannel)
    }
  }, [])

  // handle reconnect logic
  useEffect(() => {
    if (reconnect) {
      handleConnect(AuthStatus.Reconnect)
    }
  }, [reconnect])

  const getAuthUrl = async (type?: string) => {
    const redirectUrl = copilotDashboardUrl
    const url = `/api/quickbooks/auth?token=${token}${type ? `&type=${type}` : ''}`
    setLoading(true)
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ redirectUrl }),
    })

    return await response.json()
  }

  const handleConnect = async (type?: string) => {
    setHasConnection(false)
    setLoading(true)
    const authUrl = await getAuthUrl(type)
    if (authUrl) window.open(authUrl, '_blank')
  }

  const checkPortalConnection = async () => {
    const response = await fetch(
      `/api/quickbooks/token/check-connection?token=${token}`,
    )
    const data = await response.json()
    setHasConnection(data && Object.keys(data).length > 0)
  }

  return {
    loading,
    handleConnect,
    hasConnection,
    checkPortalConnection,
    isSyncOn,
    isReconnecting,
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

    if (code && realmId && state) {
      const tokenExchange = async () => {
        await handleTokenExchange(
          {
            code,
            realmId,
          },
          state,
        )
      }

      tokenExchange()
    }
  }, [])

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
    setTimeout(() => {
      window.close()
    }, 2000)
  }

  return { loading, error }
}
