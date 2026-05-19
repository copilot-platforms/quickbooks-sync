// Doc: https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
export const QBOErrorCodes = {
  BUSINESS_VALIDATION: 6000,
  DUPLICATE_DOC_NUMBER: 6140,
  ACCOUNT_SUSPENDED: 6190,
  DUPLICATE_NAME_EXISTS: 6240, // customer/vendor/employee name collision
} as const

export type QBOErrorCode = (typeof QBOErrorCodes)[keyof typeof QBOErrorCodes]

export const AccountErrorCodes: readonly number[] = [
  QBOErrorCodes.ACCOUNT_SUSPENDED,
  QBOErrorCodes.BUSINESS_VALIDATION,
]

export const OAuthErrorCodes = {
  INVALID_GRANT: 'invalid_grant',
} as const
