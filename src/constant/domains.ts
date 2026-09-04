import { copilotEnv } from '@/config'

export const DASHBOARD_DOMAIN =
  copilotEnv === '__SECRET_STAGING__'
    ? [
        'https://dashboard.assembly-staging.com',
        'https://dashboard.copilot-staging.app',
        'https://dashboard.copilot-staging.com',
      ]
    : ['https://dashboard.assembly.com', 'https://dashboard.copilot.app']

export const API_DOMAIN =
  copilotEnv === '__SECRET_STAGING__'
    ? 'https://api.copilot-staging.app'
    : 'https://api.copilot.app'
