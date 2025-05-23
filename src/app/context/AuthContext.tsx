'use client'
import { Token } from '@/type/common'
import { createContext, useContext, useState, ReactNode } from 'react'

type AuthContextType = {
  token: string
  tokenPayload: Token
  syncFlag: boolean
  reconnect: boolean
  portalConnectionStatus: boolean
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
  children,
}: AuthContextType & { children: ReactNode }) => {
  const [authParams, setAuthParams] = useState<AuthContextType>({
    token,
    tokenPayload,
    syncFlag,
    reconnect,
    portalConnectionStatus,
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
