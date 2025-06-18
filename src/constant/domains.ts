import { copilotEnv } from '@/config'

export const DASHBOARD_DOMAIN = 'https://dashboard.copilot.app'
export const API_DOMAIN =
  copilotEnv === 'production'
    ? 'https://api.copilot.app'
    : 'https://api.copilot-staging.app'
