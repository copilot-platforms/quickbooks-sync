'use client'

import ClientErrorBoundary from '@/app/error'
import { useRouter } from 'next/navigation'

interface SilentErrorProps {
  message: string
  resetFn?: () => void
}
export const SilentError = ({ message, resetFn }: SilentErrorProps) => {
  const router = useRouter()

  return (
    <ClientErrorBoundary
      error={new Error(message)}
      reset={resetFn || router.refresh}
    />
  )
  // Make sure this `error` is never actually thrown
}
