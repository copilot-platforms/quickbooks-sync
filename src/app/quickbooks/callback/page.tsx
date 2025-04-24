'use client'

import { useQuickbooksCallback } from '@/hook/useQuickbooks'
import { useEffect } from 'react'

export default function QuickBooksCallback() {
  const { loading, handleTokenExchange, handleRedirect } =
    useQuickbooksCallback()

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

  // TODO: show 404 page if not relevant search

  return (
    <div className="w-full h-screen flex items-center justify-center text-xl">
      {loading ? (
        'Connecting to QuickBooks...'
      ) : (
        <>
          Connected!
          <button
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ms-2 text-sm"
            onClick={handleRedirect}
          >
            Go back to dashboard
          </button>
        </>
      )}
    </div>
  )
}
