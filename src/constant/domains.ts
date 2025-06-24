import { copilotEnv } from '@/config'

export const DASHBOARD_DOMAIN =
  copilotEnv === 'production'
    ? 'https://dashboard.copilot.app'
    : 'https://dashboard.copilot-staging.app'
export const API_DOMAIN = 'https://api.copilot.app'
