import { copilotDashboardUrl } from '@/config'
import { useState } from 'react'

export const useQuickbooks = (token: string) => {
  const [loading, setLoading] = useState(false)
  const [hasConnection, setHasConnection] = useState(false)

  const getAuthUrl = async () => {
    const redirectUrl = copilotDashboardUrl
    setLoading(true)
    const response = await fetch(`/api/quickbooks/auth?token=${token}`, {
      method: 'POST',
      body: JSON.stringify({ redirectUrl }),
    })
    return await response.json()
  }

  const handleConnect = async () => {
    const authUrl = await getAuthUrl()
    window.open(authUrl, '_blank')
  }

  const checkPortalConnection = async () => {
    const response = await fetch(`/api/quickbooks/token?token=${token}`)
    const data = await response.json()
    setHasConnection(data && Object.keys(data).length > 0)
  }

  return {
    loading,
    handleConnect,
    hasConnection,
    checkPortalConnection,
  }
}

export const useQuickbooksCallback = () => {
  const [loading, setLoading] = useState(true)
  const [redirectUrl, setRedirectUrl] = useState<string>('')

  const handleTokenExchange = async (
    body: {
      code: string
      realmId: string
    },
    state: string,
  ) => {
    try {
      setLoading(true)
      const parsedState = JSON.parse(state)
      const token = parsedState.token
      setRedirectUrl(parsedState.originUrl)
      const response = await fetch(
        `/api/quickbooks/auth/token-exchange?token=${token}`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      )
      setLoading(false)

      return await response.json()
    } catch (err) {
      console.log({ err })
    }
  }

  const handleRedirect = async () => {
    window.open(redirectUrl, '_self') // redirect back to origin Url
  }

  return {
    loading,
    handleTokenExchange,
    handleRedirect,
  }
}
