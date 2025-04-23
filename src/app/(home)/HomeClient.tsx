'use client'
import { useQuickbooks } from '@/hook/useQuickbooks'

export default function HomeClient({
  token,
  portalConnectionStatus,
}: {
  token: string
  portalConnectionStatus: boolean
}) {
  const { loading, handleConnect, hasConnection, checkPortalConnection } =
    useQuickbooks(token)

  return (
    <div className="w-full h-screen flex items-center justify-center text-xl">
      {hasConnection || portalConnectionStatus ? (
        <>QuickBooks is connected</>
      ) : (
        <>
          {loading ? (
            <div className="flex items-end">
              Connecting to QuickBooks...
              {/* TODO: show component after few seconds, loading spinner */}
              <button
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ms-2 text-sm"
                onClick={checkPortalConnection}
              >
                Check for connection
              </button>
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
