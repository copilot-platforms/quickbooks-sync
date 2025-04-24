// TODO: parse env vars
import { EnvironmentType } from 'intuit-oauth'

export const copilotDashboardUrl =
  process.env.NEXT_PUBLIC_COPILOT_DASHBOARD_URL || ''
export const copilotAPIKey = process.env.COPILOT_API_KEY || ''
export const appId = process.env.NEXT_PUBLIC_COPILOT_APP_API_KEY || ''
export const databaseUrl = process.env.DATABASE_URL

export const apiUrl =
  process.env.VERCEL_ENV === 'production'
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_ENV === 'preview'
      ? `https://${process.env.VERCEL_BRANCH_URL}`
      : `http://${process.env.VERCEL_URL}`

// Intuit credentials
export const intuitClientId = process.env.INTUIT_CLIENT_ID || ''
export const intuitClientSecret = process.env.INTUIT_CLIENT_SECRET || ''
export const intuitRedirectUri = apiUrl + process.env.INTUIT_REDIRECT_URI_PATH
export const intuitEnvironment = (process.env.INTUIT_ENVIRONMENT ||
  'sandbox') as EnvironmentType
export const intuitIntuitCompanyId = process.env.INTUIT_COMPANY_ID || ''
