'use client'
import { ProductMappingItemType } from '@/db/schema/qbProductSync'
import { Token } from '@/type/common'
import { createContext, useContext, useState, ReactNode } from 'react'

type AppContextType = {
  token: string
  tokenPayload: Token
  syncFlag: boolean
  reconnect: boolean
  portalConnectionStatus: boolean | null
  isEnabled: boolean
  lastSyncTimestamp: string | null
  showProductConfirm?: boolean
  initialProductMap?: ProductMappingItemType[] // initial product mapped value
  enableAppIndicator?: boolean // flag to indicate whether to enable the "Enable App" button
  initialInvoiceSettingMapFlag?: boolean // flag to determine the initial invoice setting flag
  initialProductSettingMapFlag?: boolean // flag to determine the initial product setting flag
}

const AppContext = createContext<
  | (AppContextType & {
      setAppParams: React.Dispatch<React.SetStateAction<AppContextType>>
    })
  | null
>(null)

export const AppProvider = ({
  token,
  tokenPayload,
  syncFlag,
  reconnect,
  portalConnectionStatus,
  isEnabled,
  lastSyncTimestamp,
  showProductConfirm = false,
  initialProductMap = [],
  enableAppIndicator = false,
  initialInvoiceSettingMapFlag = false,
  initialProductSettingMapFlag = false,
  children,
}: AppContextType & { children: ReactNode }) => {
  const [authParams, setAppParams] = useState<AppContextType>({
    token,
    tokenPayload,
    syncFlag,
    reconnect,
    portalConnectionStatus,
    lastSyncTimestamp,
    isEnabled,
    showProductConfirm,
    initialProductMap,
    enableAppIndicator,
    initialInvoiceSettingMapFlag,
    initialProductSettingMapFlag,
  })
  return (
    <AppContext.Provider
      value={{
        ...authParams,
        setAppParams,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used within AppProvider')
  return context
}
