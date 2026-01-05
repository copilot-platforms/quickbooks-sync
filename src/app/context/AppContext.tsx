'use client'
import { ProductMappingItemType } from '@/db/schema/qbProductSync'
import { Token, WorkspaceResponse } from '@/type/common'
import { IntuitAPITokensType } from '@/utils/intuitAPI'
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
  workspace: WorkspaceResponse
  nonUsCompany?: boolean
  qbTokens?: IntuitAPITokensType
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
  workspace,
  children,
}: AppContextType & { children: ReactNode }) => {
  const [appParams, setAppParams] = useState<AppContextType>({
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
    workspace,
  })
  return (
    <AppContext.Provider
      value={{
        ...appParams,
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
