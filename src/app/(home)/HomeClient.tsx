'use client'
import { SilentError } from '@/components/template/SilentError'
import { useQuickbooks } from '@/hook/useQuickbooks'
import { Token } from '@/type/common'

export default function HomeClient({
  token,
  tokenPayload,
  portalConnectionStatus,
  syncFlag,
}: {
  token: string
  tokenPayload: Token
  portalConnectionStatus: boolean
  syncFlag: boolean
}) {
  const { loading, handleConnect, hasConnection, isSyncOn } = useQuickbooks(
    token,
    tokenPayload,
    syncFlag,
  )

  if (hasConnection === null) {
    return (
      <SilentError
        message="Error connecting to QuickBooks"
        resetFn={handleConnect}
      />
    )
  }

  return (
    <div className="home-client-wrapper w-full h-screen flex items-center justify-center text-xl">
      {hasConnection || portalConnectionStatus ? (
        <div>
          QuickBooks is connected
          <div className="text-center text-sm">
            {isSyncOn ? (
              <span className="text-green-700">Sync is on</span>
            ) : (
              <span className="text-red-700">Sync is off</span>
            )}
          </div>
        </div>
      ) : (
        <>
          {loading ? (
            <div className="flex items-end">
              Connecting to QuickBooks. Please wait...
            </div>
          ) : (
            <button
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded text-sm"
              onClick={handleConnect}
              disabled={loading}
            >
              Connect to QuickBooks
            </button>
          )}
        </>
      )}
    </div>
  )
}
