'use client'
import { useAuth } from '@/app/context/AuthContext'
import { Main as DashboardMain } from '@/components/dashboard/Main'
import { SilentError } from '@/components/template/SilentError'
import { useQuickbooks } from '@/hook/useQuickbooks'
import { Button, Spinner } from 'copilot-design-system'

export default function HomeClient() {
  const { token, tokenPayload, reconnect, portalConnectionStatus } = useAuth()

  const { loading, handleConnect, hasConnection, isReconnecting } =
    useQuickbooks(token, tokenPayload, reconnect)

  if (hasConnection === null) {
    return (
      <SilentError
        message="Error connecting to QuickBooks"
        resetFn={handleConnect}
      />
    )
  }

  return (
    <div className="home-client-wrapper w-full h-full">
      {hasConnection || portalConnectionStatus ? (
        <div>
          {isReconnecting && (
            <div>
              Reconnecting to QuickBooks <Spinner size={5} />
            </div>
          )}
          <DashboardMain />
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-xl">
          {loading ? (
            <div className="flex items-center">
              <span className="me-2">
                Connecting to QuickBooks. Please wait
              </span>{' '}
              <Spinner size={5} />
            </div>
          ) : (
            <Button
              label="Connect to QuickBooks"
              onClick={() => handleConnect()}
              disabled={loading}
            />
          )}
        </div>
      )}
    </div>
  )
}
