'use client'
import { useApp } from '@/app/context/AppContext'
import { Main as DashboardMain } from '@/components/dashboard/Main'
import { useAppBridge } from '@/hook/useQuickbooks'

export default function HomeClient() {
  const { token, portalConnectionStatus, isEnabled, syncFlag } = useApp()

  // bridge related logics like disconnect app and download sync log csv
  useAppBridge({
    token,
    isEnabled,
    syncFlag,
    connectionStatus: portalConnectionStatus || false,
  })

  return (
    <div className="home-client-wrapper w-full h-full">
      <DashboardMain />
    </div>
  )
}
