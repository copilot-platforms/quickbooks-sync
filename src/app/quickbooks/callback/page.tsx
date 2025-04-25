'use client'

import { useQuickbooksCallback } from '@/hook/useQuickbooks'

export default function QuickBooksCallback() {
  const { loading, error } = useQuickbooksCallback()

  // TODO: show 404 page if not relevant search

  return (
    <div className="w-full h-screen flex items-center justify-center text-xl">
      {error ? (
        `${error}!!!`
      ) : loading ? (
        'Connecting to QuickBooks...'
      ) : (
        <>Connected!</>
      )}
    </div>
  )
}
