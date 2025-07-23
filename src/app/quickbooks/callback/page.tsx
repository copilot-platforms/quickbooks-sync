'use client'

import { useQuickbooksCallback } from '@/hook/useQuickbooks'
import { Spinner } from 'copilot-design-system'

export default function QuickBooksCallback() {
  const { loading, error } = useQuickbooksCallback()

  // TODO: show 404 page if not relevant search

  return (
    <div className="w-full h-full flex items-center justify-center text-xl">
      {error ? (
        `${error}`
      ) : loading ? (
        <>
          <span className="me-2">Connecting to QuickBooks</span>
          <Spinner size={5} />
        </>
      ) : (
        <>Connected!</>
      )}
    </div>
  )
}
