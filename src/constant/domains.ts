import { copilotEnv } from '@/config'

export const DASHBOARD_DOMAIN =
  copilotEnv === 'production'
    ? ['https://dashboard.assembly.com', 'https://dashboard.copilot.app']
    : [
        'https://dashboard.assembly-staging.com',
        'https://dashboard.copilot-staging.app',
        'https://dashboard.copilot-staging.com',
      ]
export const API_DOMAIN =
  copilotEnv === 'production'
    ? 'https://api.copilot.app'
    : 'https://api.copilot-staging.app'
