'use client'
import { ProductMappingItemType } from '@/db/schema/qbProductSync'
import { Token } from '@/type/common'
import { createContext, useContext, useState, ReactNode } from 'react'

type AuthContextType = {
  token: string
  tokenPayload: Token
  syncFlag: boolean
  reconnect: boolean
  portalConnectionStatus: boolean
  isEnabled: boolean
  lastSyncTimestamp: string | null
  showProductConfirm?: boolean
  initialProductMap?: ProductMappingItemType[]
}

const AuthContext = createContext<
  | (AuthContextType & {
      setAuthParams: React.Dispatch<React.SetStateAction<AuthContextType>>
    })
  | null
>(null)

export const AuthProvider = ({
  token,
  tokenPayload,
  syncFlag,
  reconnect,
  portalConnectionStatus,
  isEnabled,
  lastSyncTimestamp,
  showProductConfirm = false,
  initialProductMap = [],
  children,
}: AuthContextType & { children: ReactNode }) => {
  const [authParams, setAuthParams] = useState<AuthContextType>({
    token,
    tokenPayload,
    syncFlag,
    reconnect,
    portalConnectionStatus,
    lastSyncTimestamp,
    isEnabled,
    showProductConfirm,
    initialProductMap,
  })
  return (
    <AuthContext.Provider value={{ ...authParams, setAuthParams }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
